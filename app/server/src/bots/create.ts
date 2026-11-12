import { reloadMcp, removeAppsServer } from '../connectors/hermes-mcp.js'
import { HermesRpcError, type Rpc } from '../hermes/errors.js'
import type { HermesRest } from '../hermes/rest-client.js'
import { log } from '../log.js'
import { type CrewAvatar, avatarMetaPatch, deriveAvatarType } from './avatar.js'
import { withBotLock } from './bot-lock.js'
import type { BotRole } from './cosmetics.js'
import { refreshQuietly } from './refresh.js'
import { applyCreateSandbox } from './sandbox-create.js'
import { readRawConfig, writeConfig, type SandboxDeps } from './sandbox.js'
import { rawList, type SandboxMarker } from './sandbox-state.js'
import { composeSoul, newOwnerPart } from './soul.js'
import { readBotMeta, updateBotMeta } from './ui-meta.js'

const CREATE_TIMEOUT_MS = 120_000
const BOT_CHAT_TITLE = 'Bot Chat'

export interface BotDraft {
  readonly name: string
  readonly title: string
  readonly mission: string
  readonly avatar: CrewAvatar
  readonly image?: string
  /** Written with the look only when non-null. */
  readonly role?: BotRole | null
  readonly model?: { readonly provider: string; readonly model: string }
  /** Run the bot's tools in a sandbox; absent means off. */
  readonly sandbox?: boolean
}

export type StepOutcome = 'ok' | 'skipped' | 'failed'
type FailedStep = 'apps' | 'sandbox' | 'look' | 'avatar' | 'chat'

export interface CreateResult {
  readonly name: string
  readonly complete: boolean
  readonly steps: { readonly profile: 'ok'; readonly apps: StepOutcome; readonly sandbox: StepOutcome; readonly look: StepOutcome; readonly avatar: StepOutcome; readonly chat: StepOutcome }
  readonly needsModel: boolean
  readonly error?: { readonly step: FailedStep; readonly message: string }
}

export interface BotDeps {
  readonly rpc: Rpc
  readonly rest: HermesRest
  refresh(): Promise<void>
  now(): number
  /** Absent only in tests: delete then skips the sandbox cleanup. */
  readonly sandbox?: SandboxDeps
  /** Absent only in tests: delete then skips forgetting the bot's apps. */
  readonly apps?: {
    forget(bot: string): Promise<void>
    clamp?(bot: string, raw: unknown): void
    /** Replace the bot's relay token and entry; rejects, or resolves false, when that did not fully go through. */
    rotate?(bot: string): Promise<boolean>
    /** The bot's entry was just removed: if apps are on for it in Crew, have the backfill write the entry again. */
    restore?(bot: string): Promise<void>
  }
}

/** `profiles.create` refused the name: it exists, or Hermes rejected it (message from Hermes). */
export class CreateBotError extends Error {
  constructor(
    readonly kind: 'name_taken' | 'bad_name',
    message: string
  ) {
    super(message)
    this.name = 'CreateBotError'
  }
}

interface FinishBody {
  readonly avatar?: CrewAvatar
  readonly title?: string
  readonly image?: string
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const titleCase = (name: string): string => name.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, ch => ch.toUpperCase())

/**
 * Run one best-effort step; a failure is recorded and never stops the steps after it. The one exception
 * is the chat, which is not made while the apps step is failed, so Finish setup has to pass first. That
 * is a convenience, not the protection: Hermes serves the profile either way. What keeps a clone off the
 * primary's apps is the relay's identity check plus the rotation of the primary's token (`securePrimary`).
 */
class Steps {
  private first: CreateResult['error']
  readonly outcome: Record<FailedStep, StepOutcome> = { apps: 'skipped', sandbox: 'skipped', look: 'skipped', avatar: 'skipped', chat: 'skipped' }

  async run(step: FailedStep, action: () => Promise<void>): Promise<void> {
    try {
      await action()
      this.outcome[step] = 'ok'
    } catch (error) {
      this.outcome[step] = 'failed'
      this.first ??= { step, message: messageOf(error) }
    }
  }

  result(name: string, needsModel: boolean): CreateResult {
    return {
      name,
      complete: this.first === undefined,
      steps: { profile: 'ok', ...this.outcome },
      needsModel,
      ...(this.first ? { error: this.first } : {})
    }
  }
}

const setAvatar = (deps: BotDeps, name: string, image: string) => async (): Promise<void> => {
  await deps.rpc('profiles.set_asset', { name, asset: 'avatar', data: image })
}

// `session.create` with a title is idempotent on the canonical-authority socket (F§1.2).
const ensureChat = (deps: BotDeps, name: string) => async (): Promise<void> => {
  await deps.rpc('session.create', { profile: name, title: BOT_CHAT_TITLE, hidden: true, follow_profile_config: true })
}

async function runtimeNeedsModel(deps: BotDeps, name: string): Promise<boolean> {
  try {
    return (await deps.rpc<{ ok?: boolean }>('setup.runtime_check', { profile: name })).ok === false
  } catch (error) {
    // Falling back to "has a model" is intended, but a check that keeps failing must leave a trace.
    log.warn('runtime check failed', { name, error: messageOf(error).slice(0, 200) })
    return false
  }
}

async function createProfile(deps: BotDeps, draft: BotDraft): Promise<void> {
  const { name, title, mission, model } = draft
  try {
    await deps.rpc('profiles.create', {
      name,
      description: mission,
      clone_from: 'default',
      share_auth: true,
      no_skills: false,
      soul: composeSoul(newOwnerPart({ name, title, mission })),
      ...(model ? { model: model.model, provider: model.provider } : {})
    }, CREATE_TIMEOUT_MS)
  } catch (error) {
    if (error instanceof HermesRpcError && error.code === 4062) {
      throw new CreateBotError(/already exists/i.test(error.message) ? 'name_taken' : 'bad_name', error.message)
    }
    throw error
  }
}

/**
 * Create a bot the way the official client does (F§1.2). `profiles.create` is atomic; every later step
 * is best-effort and independent, so a failure is reported in the result and the rest still run.
 * The name must already pass `validateBotName`. No intro turn is sent (costs a model call).
 */
export function createBot(deps: BotDeps, draft: BotDraft): Promise<CreateResult> {
  return withBotLock(draft.name, () => runCreate(deps, draft))
}

/** The look and, when the sandbox step produced one, its marker go in one write (R7). */
const writeLook = (deps: BotDeps, draft: BotDraft, marker: SandboxMarker | undefined) => async (): Promise<void> => {
  await updateBotMeta(deps.rpc, draft.name, {
    ...avatarMetaPatch(draft.avatar),
    imageKind: draft.image ? 'photo' : 'shape',
    title: draft.title,
    created: deps.now(),
    ...(draft.role ? { role: draft.role } : {}),
    ...(marker ? { sandbox: marker } : {})
  })
}

const APP_GRANT = 'mcp:crew_apps/'

/**
 * The apps strip (§11.6): the cloned server goes, and so do "always" grants for app tools the primary
 * collected; a new bot must ask for each one. Never touches `default`. Hermes serves a clone at once,
 * so the nudge makes it drop a connection opened from the cloned entry now, not on its next 60 s tick
 * (the relay refuses that connection either way: its identity is the clone's, its URL the primary's).
 */
async function stripApps(deps: BotDeps, name: string): Promise<void> {
  await removeAppsServer(deps, name)
  await reloadMcp(deps, name, false)
  const list = rawList((await readRawConfig(deps, name)).command_allowlist)
  const kept = list.filter(e => !(typeof e === 'string' && e.startsWith(APP_GRANT)))
  if (kept.length === list.length) return
  await writeConfig(deps, name, { command_allowlist: kept })
}

/** Every bot is cloned from this profile (`createProfile`). */
const PRIMARY = 'default'

/**
 * The strip failed, so the clone may still hold a copy of the primary's relay token in its `.env`. The
 * relay's identity header only stops the cloned config as it is; it is not a credential, and a token
 * holder can send any name. So the primary's token is replaced, which makes the copy worthless. Never
 * rejects: a failure is logged (no token) and the bot stays incomplete, so Finish setup runs both again.
 */
async function securePrimary(deps: BotDeps, name: string): Promise<void> {
  if (name === PRIMARY || !deps.apps?.rotate) return
  try {
    if (await deps.apps.rotate(PRIMARY)) return
    log.warn('primary apps token rotation not confirmed', { name })
  } catch (error) {
    log.warn('primary apps token rotation failed', { name, error: error instanceof Error ? error.name : 'unknown' })
  }
}

/** The apps step: the strip, then `after`; when either fails the primary's token is replaced. */
async function appsStep(deps: BotDeps, steps: Steps, name: string, after?: () => Promise<void>): Promise<void> {
  await steps.run('apps', async () => {
    await stripApps(deps, name)
    await after?.()
  })
  if (steps.outcome.apps === 'failed') await securePrimary(deps, name)
}

async function runCreate(deps: BotDeps, draft: BotDraft): Promise<CreateResult> {
  await createProfile(deps, draft)
  const steps = new Steps()
  await appsStep(deps, steps, draft.name)
  let marker: SandboxMarker | undefined
  await steps.run('sandbox', async () => {
    marker = await applyCreateSandbox(deps, draft.name, draft.sandbox ?? false)
  })
  await steps.run('look', writeLook(deps, draft, marker))
  if (draft.image) await steps.run('avatar', setAvatar(deps, draft.name, draft.image))
  const needsModel = await runtimeNeedsModel(deps, draft.name)
  if (steps.outcome.apps === 'ok') await steps.run('chat', ensureChat(deps, draft.name))
  deps.sandbox?.onChanged?.(draft.name)
  await refreshQuietly(deps)
  return steps.result(draft.name, needsModel)
}

/**
 * Complete a half-made bot: write the look only if it never had one (revision 0), upload an avatar when
 * given, and make sure Bot Chat exists. Throws `BotNotFoundError` for an unknown profile.
 */
export function finishBot(deps: BotDeps, name: string, body: FinishBody): Promise<CreateResult> {
  return withBotLock(name, () => runFinish(deps, name, body))
}

async function runFinish(deps: BotDeps, name: string, body: FinishBody): Promise<CreateResult> {
  const { revision } = await readBotMeta(deps.rpc, name)
  const steps = new Steps()
  // Finish always strips (it cannot tell a cloned entry from the bot's own), so a finished bot that has
  // apps in Crew gets its entry back: restore unmarks the record and the backfill writes a fresh one.
  await appsStep(deps, steps, name, async () => { await deps.apps?.restore?.(name) })
  if (revision === 0) {
    const patch = {
      ...avatarMetaPatch(body.avatar ?? { type: deriveAvatarType(name) }),
      imageKind: body.image ? 'photo' as const : 'shape' as const, title: body.title ?? titleCase(name), created: deps.now()
    }
    await steps.run('look', async () => {
      await updateBotMeta(deps.rpc, name, patch)
    })
  }
  if (body.image) await steps.run('avatar', setAvatar(deps, name, body.image))
  if (steps.outcome.apps === 'ok') await steps.run('chat', ensureChat(deps, name))
  await refreshQuietly(deps)
  return steps.result(name, false)
}
