export type PendingKind = 'approval' | 'clarify' | 'sudo' | 'secret'
/** Where the watcher saw the request — recorded so the Phase 0 experiment shows which channel Hermes uses. */
export type PendingSource = 'server_request' | 'open_request' | 'snapshot_prompt' | 'event'
/** `settled`: Hermes no longer lists it (answered, withdrawn or expired — the reason is not reported). */
export type SettleReason = 'answered' | 'cancelled' | 'expired' | 'settled'

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
  readonly settledAt?: number
}

/** In-memory record of requests waiting for the user. First sighting of an id wins (no duplicates). */
export class PendingStore {
  private readonly entries = new Map<string, PendingRequest>()
  private readonly listeners = new Set<() => void>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Called after any add / settle / prune that changed what `list()` or `get()` returns. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  add(request: PendingRequest): void {
    if (this.entries.has(request.id)) return
    this.entries.set(request.id, request)
    this.notify()
  }

  settle(id: string, reason: SettleReason): void {
    const entry = this.entries.get(id)
    if (!entry || entry.settled) return
    this.entries.set(id, { ...entry, settled: reason, settledAt: this.now() })
    this.notify()
  }

  /** Forget entries that settled more than `olderThanMs` ago (they only exist to explain late answers). */
  prune(olderThanMs: number): void {
    const cutoff = this.now() - olderThanMs
    for (const [id, entry] of this.entries) {
      if (entry.settledAt !== undefined && entry.settledAt <= cutoff) this.entries.delete(id)
    }
  }

  /**
   * A fresh snapshot is authoritative for its session: settle prompt-based entries of that session that
   * it no longer lists and that were seen before the snapshot was requested (covers a missed *.settled
   * event, e.g. after a gateway crash). Legacy server requests are left alone.
   */
  reconcile(sessionIds: readonly string[], liveIds: ReadonlySet<string>, requestedAt: number): void {
    for (const entry of this.list()) {
      const promptBased = entry.source === 'event' || entry.source === 'snapshot_prompt'
      if (promptBased && sessionIds.includes(entry.sessionId) && !liveIds.has(entry.id) && entry.receivedAt < requestedAt) {
        this.settle(entry.id, 'settled')
      }
    }
  }

  /** Unsettled requests, oldest first. */
  list(): readonly PendingRequest[] {
    return [...this.entries.values()].filter(entry => !entry.settled)
  }

  get(id: string): PendingRequest | undefined {
    return this.entries.get(id)
  }
}
