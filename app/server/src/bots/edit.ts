import { log } from '../log.js'
import { type CrewAvatar, avatarMetaPatch, readCrewAvatar } from './avatar.js'
import { withBotLock } from './bot-lock.js'
import { type BotRole, readPinned, readRole } from './cosmetics.js'
import type { BotDeps } from './create.js'
import { refreshQuietly } from './refresh.js'
import { cleanupBeforeDelete } from './sandbox-cleanup.js'
import { removeQuietly } from './sandbox.js'
import { type BotMeta, BotNotFoundError, BotMetaWriteError, updateBotMeta } from './ui-meta.js'

const PRIMARY = 'default'
const DELETE_TIMEOUT_MS = 60_000

export interface ModelChoice {
  readonly provider: string
  readonly model: string
}

export interface BotDetail {
  readonly name: string
  readonly isPrimary: boolean
  readonly title: string
  readonly look: { readonly shape: string | null; readonly color: string | null; readonly imageKind: 'photo' | 'shape' | null }
  readonly avatar: CrewAvatar | null
  readonly hidden: boolean
  readonly pinned: boolean
  readonly role: BotRole | null
  readonly description: string
  readonly soul: string
  readonly model: ModelChoice | null
  readonly metaRevision: number
}

/** Only the look keys the user changed; the others stay as stored (a Hermes shape Crew can't offer survives). */
export interface LookPatch {
  readonly shape?: string
  readonly color?: string
}

export interface BotPatch {
  readonly title?: string
  readonly look?: LookPatch
  readonly avatar?: CrewAvatar
  readonly hidden?: boolean
  readonly pinned?: boolean
  readonly role?: BotRole | null
  readonly description?: string
  readonly soul?: string
  readonly model?: ModelChoice
  readonly confirmExpensiveModel?: boolean
  readonly baseline?: { readonly description?: string; readonly soul?: string; readonly model?: ModelChoice | null }
}

type Guarded = 'description' | 'soul' | 'model'
export type UpdateOutcome =
  | { status: 'saved'; detail: BotDetail }
  | { status: 'conflict'; fields: Guarded[]; current: BotDetail }
  | { status: 'confirm_required'; message: string }

/** A section Hermes answered `applied.<section> === false` for. */
export class NotSavedError extends Error {
  constructor(readonly section: string) {
    super(`hermes did not save ${section}`)
    this.name = 'NotSavedError'
  }
}

export class PrimaryBotError extends Error {
  constructor() {
    super('the primary bot cannot be deleted')
    this.name = 'PrimaryBotError'
  }
}

interface ListRow {
  readonly name: string
  readonly description?: string | null
  readonly display_name?: string | null
  readonly ui_meta?: Record<string, unknown> | null
  readonly ui_meta_revisions?: Record<string, unknown> | null
}
interface RestRow { readonly name: string; readonly model?: string | null; readonly provider?: string | null }
interface ConfigureReply {
  readonly applied?: Record<string, unknown>
  readonly confirm_required?: boolean
  readonly confirm_message?: string
}

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')
const titleCase = (name: string): string => name.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, ch => ch.toUpperCase())
const enc = (name: string): string => encodeURIComponent(name)
const sameModel = (a: ModelChoice | null | undefined, b: ModelChoice | null): boolean =>
  (a ?? null) === b || (!!a && !!b && a.provider === b.provider && a.model === b.model)

/**
 * The current state of one bot from the reads Crew trusts: RPC `profiles.list` (look, revision,
 * description), REST soul, and the REST roster row for model/provider (the RPC list blanks siblings, F§5).
 */
export async function readBotDetail(deps: BotDeps, name: string): Promise<BotDetail> {
  const [list, soul, roster] = await Promise.all([
    deps.rpc<{ profiles: readonly ListRow[] }>('profiles.list', { include_sessions: false }),
    deps.rest.request<{ content?: string | null; exists?: boolean }>('GET', `/api/profiles/${enc(name)}/soul`),
    deps.rest.request<{ profiles?: readonly RestRow[] }>('GET', '/api/profiles')
  ])
  const row = list.profiles.find(p => p.name === name)
  if (!row) throw new BotNotFoundError(name)
  const raw = row.ui_meta?.['hermes-bots']
  const meta = (raw && typeof raw === 'object' ? raw : {}) as BotMeta
  const revision = row.ui_meta_revisions?.['hermes-bots']
  const rest = roster.profiles?.find(p => p.name === name)
  const isPrimary = name === PRIMARY
  const imageKind = meta.imageKind === 'photo' || meta.imageKind === 'shape' ? meta.imageKind : null
  return {
    name,
    isPrimary,
    title: text(meta.title) || text(row.display_name) || (isPrimary ? 'Hermes' : titleCase(name)),
    look: { shape: text(meta.shape) || null, color: text(meta.color) || null, imageKind },
    avatar: readCrewAvatar(meta.crewAvatar),
    hidden: meta.hidden === true,
    pinned: readPinned(meta.pinned),
    role: readRole(meta.role),
    description: typeof row.description === 'string' ? row.description : '',
    soul: soul.exists === false ? '' : (soul.content ?? ''),
    model: rest?.model && rest.provider ? { provider: rest.provider, model: rest.model } : null,
    metaRevision: typeof revision === 'number' ? revision : 0
  }
}

/** Fields whose baseline was supplied and no longer matches what Hermes holds. */
function changedSince(patch: BotPatch, current: BotDetail): Guarded[] {
  const base = patch.baseline
  if (!base) return []
  const fields: Guarded[] = []
  if (patch.description !== undefined && base.description !== undefined && base.description !== current.description) fields.push('description')
  if (patch.soul !== undefined && base.soul !== undefined && base.soul !== current.soul) fields.push('soul')
  if (patch.model !== undefined && base.model !== undefined && !sameModel(base.model, current.model)) fields.push('model')
  return fields
}

async function configure(deps: BotDeps, params: Record<string, unknown>, section: string): Promise<ConfigureReply> {
  const reply = await deps.rpc<ConfigureReply>('profiles.configure', params)
  if (reply.applied?.[section] === false) throw new NotSavedError(section)
  return reply
}

function metaPatch(patch: BotPatch): Partial<BotMeta> {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.hidden !== undefined ? { hidden: patch.hidden } : {}),
    // false and null are real values: unpinning must overwrite a stale `true` from another client.
    ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
    ...(patch.role !== undefined ? { role: patch.role } : {}),
    ...(patch.look ? { ...(patch.look.shape !== undefined ? { shape: patch.look.shape } : {}), ...(patch.look.color !== undefined ? { color: patch.look.color } : {}), custom: true } : {}),
    ...(patch.avatar ? avatarMetaPatch(patch.avatar) : {})
  }
}

/**
 * Save only the sections present in `patch`. SOUL, description and model have no revision, so each is
 * compared with the caller's baseline first and nothing is written if any changed (F§6). Writes are
 * sequential (description races ui_meta in profile.yaml, F Gotcha 16): model, ui_meta, description, soul.
 */
export function updateBot(deps: BotDeps, name: string, patch: BotPatch): Promise<UpdateOutcome> {
  return withBotLock(name, () => runUpdate(deps, name, patch))
}

async function runUpdate(deps: BotDeps, name: string, patch: BotPatch): Promise<UpdateOutcome> {
  if (patch.baseline) {
    const current = await readBotDetail(deps, name)
    const fields = changedSince(patch, current)
    if (fields.length > 0) return { status: 'conflict', fields, current }
  }
  if (patch.model) {
    const reply = await configure(deps, {
      name, model: patch.model.model, provider: patch.model.provider,
      ...(patch.confirmExpensiveModel ? { confirm_expensive_model: true } : {})
    }, 'model')
    if (reply.confirm_required) return { status: 'confirm_required', message: reply.confirm_message ?? 'This model needs confirmation.' }
  }
  const meta = metaPatch(patch)
  if (Object.keys(meta).length > 0) await writeMeta(deps, name, meta)
  if (patch.description !== undefined) await configure(deps, { name, description: patch.description }, 'description')
  if (patch.soul !== undefined) await deps.rest.request('PUT', `/api/profiles/${enc(name)}/soul`, { body: { content: patch.soul } })
  await refreshQuietly(deps)
  return { status: 'saved', detail: await readBotDetail(deps, name) }
}

async function writeMeta(deps: BotDeps, name: string, patch: Partial<BotMeta>): Promise<void> {
  try {
    await updateBotMeta(deps.rpc, name, patch)
  } catch (error) {
    if (error instanceof BotMetaWriteError) throw new NotSavedError('ui_meta')
    throw error
  }
}

/** Upload the avatar image, then mark the look as a custom photo. */
export function setAvatar(deps: BotDeps, name: string, image: string): Promise<BotDetail> {
  return withBotLock(name, async () => {
    await deps.rpc('profiles.set_asset', { name, asset: 'avatar', data: image })
    await writeMeta(deps, name, { imageKind: 'photo', custom: true })
    await refreshQuietly(deps)
    return readBotDetail(deps, name)
  })
}

export function clearAvatar(deps: BotDeps, name: string): Promise<BotDetail> {
  return withBotLock(name, async () => {
    await deps.rpc('profiles.set_asset', { name, asset: 'avatar', clear: true })
    await writeMeta(deps, name, { imageKind: 'shape' })
    await refreshQuietly(deps)
    return readBotDetail(deps, name)
  })
}

/** Delete via REST. `{ok:true}` with or without `settlement_pending` is success (F Gotcha 14). */
export function deleteBot(deps: BotDeps, name: string): Promise<void> {
  if (name === PRIMARY) return Promise.reject(new PrimaryBotError())
  return withBotLock(name, () => deleteLocked(deps, name)).then(() => forgetApps(deps, name))
}

/** After the lock is released: `forgetBot` takes the same lock. Never fails the delete. */
async function forgetApps(deps: BotDeps, name: string): Promise<void> {
  try {
    await deps.apps?.forget(name)
  } catch (error) {
    log.warn('forgetting apps after delete failed', { bot: name, error: error instanceof Error ? error.name : 'unknown' })
  }
}

async function deleteLocked(deps: BotDeps, name: string): Promise<void> {
  // Docker leaves root-owned mount points that make Hermes's own delete fail, so clear them first.
  const dockerReached = deps.sandbox ? await cleanupBeforeDelete(deps, deps.sandbox, name) : false
  await deps.rest.request('DELETE', `/api/profiles/${enc(name)}`, { timeoutMs: DELETE_TIMEOUT_MS })
  // A chat that started during the delete can leave a container behind; sweep once more, never fail the delete.
  if (deps.sandbox && dockerReached) await removeQuietly(deps.sandbox, name)
  deps.sandbox?.onChanged?.(name)
  await refreshQuietly(deps)
}
