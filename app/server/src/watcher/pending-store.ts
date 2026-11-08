export type PendingKind = 'approval' | 'clarify' | 'sudo' | 'secret'
/** Where the watcher saw the request — recorded so the Phase 0 experiment shows which channel Hermes uses. */
export type PendingSource = 'server_request' | 'open_request' | 'snapshot_prompt'
export type SettleReason = 'answered' | 'cancelled' | 'expired'

export interface PendingRequest {
  readonly id: string
  readonly kind: PendingKind
  readonly profile: string
  readonly sessionId: string
  /** Redacted, human-readable: command/description/question. Never a secret value. */
  readonly summary: string
  readonly choices?: readonly string[]
  readonly receivedAt: number
  readonly source: PendingSource
  readonly promptId?: string
  readonly executionGeneration?: number
  readonly settled?: SettleReason
}

/** In-memory record of requests waiting for the user. First sighting of an id wins (no duplicates). */
export class PendingStore {
  private readonly entries = new Map<string, PendingRequest>()

  add(request: PendingRequest): void {
    if (!this.entries.has(request.id)) this.entries.set(request.id, request)
  }

  settle(id: string, reason: SettleReason): void {
    const entry = this.entries.get(id)
    if (entry && !entry.settled) this.entries.set(id, { ...entry, settled: reason })
  }

  /** Unsettled requests, oldest first. */
  list(): readonly PendingRequest[] {
    return [...this.entries.values()].filter(entry => !entry.settled)
  }

  get(id: string): PendingRequest | undefined {
    return this.entries.get(id)
  }
}
