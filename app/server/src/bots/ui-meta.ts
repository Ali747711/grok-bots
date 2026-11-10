import type { Rpc } from '../hermes/errors.js'

import type { BotRole } from './cosmetics.js'
import type { SandboxMarker } from './sandbox-state.js'

const NAMESPACE = 'hermes-bots'
const CAS_ATTEMPTS = 3

export interface BotMeta {
  readonly [key: string]: unknown
  readonly title?: string
  readonly shape?: string
  readonly color?: string
  readonly imageKind?: 'photo' | 'shape'
  readonly created?: number
  readonly custom?: boolean
  readonly hidden?: boolean
  readonly pinned?: boolean
  readonly role?: BotRole | null
  readonly sandbox?: SandboxMarker
}

export class BotNotFoundError extends Error {
  constructor(name: string) {
    super(`bot '${name}' not found`)
    this.name = 'BotNotFoundError'
  }
}

export class BotMetaWriteError extends Error {
  constructor(readonly reason: 'rejected' | 'conflict') {
    super(`ui_meta write ${reason}`)
    this.name = 'BotMetaWriteError'
  }
}

interface ListRow {
  readonly name: string
  readonly ui_meta?: Record<string, unknown> | null
  readonly ui_meta_revisions?: Record<string, unknown> | null
}

interface ConfigureReply {
  readonly applied?: {
    readonly ui_meta?: boolean
    readonly ui_meta_conflicts?: Record<string, unknown>
    readonly ui_meta_revisions?: Record<string, unknown>
  }
}

export async function readBotMeta(rpc: Rpc, name: string): Promise<{ meta: BotMeta | null; revision: number }> {
  const { profiles } = await rpc<{ profiles: readonly ListRow[] }>('profiles.list', { include_sessions: false })
  const row = profiles.find(p => p.name === name)
  if (!row) throw new BotNotFoundError(name)
  const meta = row.ui_meta?.[NAMESPACE]
  const revision = row.ui_meta_revisions?.[NAMESPACE]
  return {
    meta: meta && typeof meta === 'object' ? (meta as BotMeta) : null,
    revision: typeof revision === 'number' ? revision : 0
  }
}

function without(source: Record<string, unknown>, drop: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => !drop.includes(key) && value !== undefined))
}

/**
 * Compare-and-swap read-modify-write of the whole `hermes-bots` namespace (Hermes `persistBotMetaPatch`):
 * base = server value minus `chat`, patch minus `image`/`pet`. A conflict is a successful reply, so
 * detect it in `applied.ui_meta_conflicts` and re-read; at most three attempts.
 */
export async function updateBotMeta(rpc: Rpc, name: string, patch: Partial<BotMeta>): Promise<{ meta: BotMeta; revision: number }> {
  for (let attempt = 0; attempt < CAS_ATTEMPTS; attempt += 1) {
    const { meta: server, revision } = await readBotMeta(rpc, name)
    const next: BotMeta = { ...without(server ?? {}, ['chat']), ...without(patch, ['image', 'pet']) }
    const reply = await rpc<ConfigureReply>('profiles.configure', {
      name,
      ui_meta: { [NAMESPACE]: next },
      ui_meta_expected_revisions: { [NAMESPACE]: revision }
    })
    if (reply.applied?.ui_meta_conflicts) continue
    if (reply.applied?.ui_meta !== true) throw new BotMetaWriteError('rejected')
    const fresh = reply.applied.ui_meta_revisions?.[NAMESPACE]
    return { meta: next, revision: typeof fresh === 'number' ? fresh : revision + 1 }
  }
  throw new BotMetaWriteError('conflict')
}
