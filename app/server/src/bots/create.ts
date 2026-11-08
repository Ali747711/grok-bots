import { HermesRpcError, type Rpc } from '../hermes/errors.js'
import type { HermesRest } from '../hermes/rest-client.js'
import { log } from '../log.js'
import { withBotLock } from './bot-lock.js'
import { composeSoul } from './soul.js'
import { type BotMeta, readBotMeta, updateBotMeta } from './ui-meta.js'

const CREATE_TIMEOUT_MS = 120_000
const BOT_CHAT_TITLE = 'Bot Chat'
const DEFAULT_LOOK: BotLook = { shape: 'squircle', color: '#6366f1' }

export interface BotLook {
  readonly shape: 'circle' | 'squircle'
  /** `#rrggbb` */
  readonly color: string
}

export interface BotDraft {
  readonly name: string
  readonly title: string
  readonly mission: string
  readonly look: BotLook
  readonly image?: string
  readonly model?: { readonly provider: string; readonly model: string }
}

export type StepOutcome = 'ok' | 'skipped' | 'failed'
type FailedStep = 'look' | 'avatar' | 'chat'

export interface CreateResult {
  readonly name: string
  readonly complete: boolean
  readonly steps: { readonly profile: 'ok'; readonly look: StepOutcome; readonly avatar: StepOutcome; readonly chat: StepOutcome }
  readonly needsModel: boolean
  readonly error?: { readonly step: FailedStep; readonly message: string }
}

export interface BotDeps {
  readonly rpc: Rpc
  readonly rest: HermesRest
  refresh(): Promise<void>
  now(): number
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
  readonly look?: BotLook
  readonly title?: string
  readonly image?: string
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const titleCase = (name: string): string => name.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, ch => ch.toUpperCase())

/** Run one best-effort step; a failure is recorded and never stops the steps after it. */
class Steps {
  private first: CreateResult['error']
  readonly outcome: Record<FailedStep, StepOutcome> = { look: 'skipped', avatar: 'skipped', chat: 'skipped' }

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

export async function refreshQuietly(deps: BotDeps): Promise<void> {
  await deps.refresh().catch((error: unknown) => {
    log.warn('roster refresh failed', { error: messageOf(error).slice(0, 200) })
  })
}

async function createProfile(deps: BotDeps, draft: BotDraft): Promise<void> {
  const { name, title, mission, model } = draft
  try {
    await deps.rpc('profiles.create', {
      name,
      description: [title, mission].filter(Boolean).join(' — '),
      clone_from: 'default',
      share_auth: true,
      no_skills: false,
      soul: composeSoul({ name, title, mission }),
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

async function runCreate(deps: BotDeps, draft: BotDraft): Promise<CreateResult> {
  await createProfile(deps, draft)
  const steps = new Steps()
  await steps.run('look', async () => {
    await updateBotMeta(deps.rpc, draft.name, {
      shape: draft.look.shape,
      color: draft.look.color,
      imageKind: draft.image ? 'photo' : 'shape',
      title: draft.title,
      created: deps.now()
    })
  })
  if (draft.image) await steps.run('avatar', setAvatar(deps, draft.name, draft.image))
  const needsModel = await runtimeNeedsModel(deps, draft.name)
  await steps.run('chat', ensureChat(deps, draft.name))
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
  if (revision === 0) {
    const look = body.look ?? DEFAULT_LOOK
    const patch: Partial<BotMeta> = {
      shape: look.shape, color: look.color, imageKind: body.image ? 'photo' : 'shape', title: body.title ?? titleCase(name), created: deps.now()
    }
    await steps.run('look', async () => {
      await updateBotMeta(deps.rpc, name, patch)
    })
  }
  if (body.image) await steps.run('avatar', setAvatar(deps, name, body.image))
  await steps.run('chat', ensureChat(deps, name))
  await refreshQuietly(deps)
  return steps.result(name, false)
}
