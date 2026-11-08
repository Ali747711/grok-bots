import type { PendingRequest } from './pending-store.js'
import type { WatcherEvent } from './request-router.js'

export type BotStatus = 'idle' | 'working' | 'needs_you'

export interface BotView {
  readonly name: string
  readonly title: string
  readonly color: string | null
  readonly shape: string | null
  readonly isPrimary: boolean
  readonly hasAvatar: boolean
  readonly model: string | null
  readonly sessionId: string | null
  readonly preview: string | null
  readonly lastActive: number | null
  readonly status: BotStatus
}

export type PendingView = Omit<PendingRequest, 'settled'> & {
  readonly state: 'open' | 'answering' | 'failed'
  /** False when Crew cannot answer it (answer in the app that asked). */
  readonly answerable: boolean
  readonly error?: string
}

export interface CrewState {
  readonly hermes: 'connected' | 'connecting' | 'signed_out' | 'offline'
  readonly bots: readonly BotView[]
  readonly pending: readonly PendingView[]
}

/** The roster fields Crew reads from a `profiles.list` row (all optional on the wire). */
export interface ProfileInput {
  readonly name: string
  readonly display_name?: string
  readonly model?: string | null
  readonly has_avatar?: boolean
  readonly ui_meta?: Record<string, unknown> | null
  readonly canonical_session?: {
    readonly id?: string
    readonly resolved_id?: string
    readonly preview?: string
    readonly last_active?: number
  } | null
}

export type TrackedEvent = WatcherEvent & { readonly execution_generation?: number }

const PRIMARY = 'default'
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

function botMeta(row: ProfileInput): Record<string, unknown> {
  const meta = row.ui_meta?.['hermes-bots']
  return meta && typeof meta === 'object' ? (meta as Record<string, unknown>) : {}
}

/** Derives per-bot status from roster rows and the live event stream. Pure state, no I/O. */
export class BotStateTracker {
  private profiles: readonly ProfileInput[] = []
  private readonly sessionProfile = new Map<string, string>()
  private readonly working = new Set<string>()
  private readonly generations = new Map<string, number>()

  applyProfiles(rows: readonly ProfileInput[]): void {
    this.profiles = rows
  }

  markSubscribed(profile: string, sessionId: string): void {
    this.sessionProfile.set(sessionId, profile)
  }

  applyEvent(event: TrackedEvent): void {
    const sid = event.session_id
    if (!sid || !this.sessionProfile.has(sid)) return
    const payload = (event.payload ?? {}) as Record<string, unknown>
    this.noteGeneration(sid, num(event.execution_generation))
    if (event.type === 'message.start') this.working.add(sid)
    else if (event.type === 'message.complete') this.working.delete(sid)
    else if (event.type === 'session.info') {
      this.noteGeneration(sid, num(payload.execution_generation))
      if (typeof payload.running === 'boolean') {
        if (payload.running) this.working.add(sid)
        else this.working.delete(sid)
      }
    }
  }

  generation(sessionId: string): number | undefined {
    return this.generations.get(sessionId)
  }

  view(pending: readonly PendingRequest[]): readonly BotView[] {
    const needing = new Set(pending.filter(p => !p.settled).map(p => p.profile))
    const busy = new Set([...this.working].map(sid => this.sessionProfile.get(sid)))
    return this.profiles.map(row => {
      const meta = botMeta(row)
      const isPrimary = row.name === PRIMARY
      const chat = row.canonical_session
      const status: BotStatus = needing.has(row.name) ? 'needs_you' : busy.has(row.name) ? 'working' : 'idle'
      return {
        name: row.name,
        title: str(meta.title) ?? str(row.display_name) ?? (isPrimary ? 'Hermes' : row.name),
        color: str(meta.color),
        shape: str(meta.shape),
        isPrimary,
        hasAvatar: row.has_avatar === true,
        model: str(row.model),
        sessionId: chat?.resolved_id ?? chat?.id ?? null,
        preview: str(chat?.preview),
        lastActive: num(chat?.last_active) ?? null,
        status
      }
    })
  }

  private noteGeneration(sid: string, generation: number | undefined): void {
    if (generation !== undefined && generation > (this.generations.get(sid) ?? -1)) this.generations.set(sid, generation)
  }
}
