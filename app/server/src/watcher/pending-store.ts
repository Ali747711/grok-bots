import { appChoices, type AppPrompt } from './app-prompt.js'

export type PendingKind = 'approval' | 'clarify' | 'sudo' | 'secret'
/** Where the watcher saw the request — recorded so the Phase 0 experiment shows which channel Hermes uses. */
export type PendingSource = 'server_request' | 'open_request' | 'snapshot_prompt' | 'event' | 'group'
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
  /** Approvals only: the complete (up to 16 384 chars each) operation being authorized. */
  readonly command?: string
  readonly description?: string
  readonly detailTruncated?: true
  /** A Crew app tool prompt: choices are clamped to once/deny on add. */
  readonly app?: AppPrompt
  readonly receivedAt: number
  readonly source: PendingSource
  readonly promptId?: string
  readonly executionGeneration?: number
  /** Group approvals only: where to send the answer. */
  readonly group?: { readonly roomId: string; readonly memberId: string; readonly taskId: string; readonly requestId: string }
  readonly settled?: SettleReason
  readonly settledAt?: number
  /** Crew-side delivery state of the user's answer; absent while nothing was sent. */
  readonly answerState?: 'answering' | 'failed'
  readonly answerError?: string
}

/** In-memory record of requests waiting for the user. First sighting of an id wins (no duplicates). */
export class PendingStore {
  private readonly entries = new Map<string, PendingRequest>()
  private readonly listeners = new Set<() => void>()
  private readonly settleListeners = new Set<(entry: PendingRequest) => void>()

  constructor(private readonly now: () => number = Date.now) {}

  /** Called after any add / settle / prune that changed what `list()` or `get()` returns. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Called once per entry, right after it becomes settled (any reason). */
  onSettle(listener: (entry: PendingRequest) => void): () => void {
    this.settleListeners.add(listener)
    return () => {
      this.settleListeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener()
  }

  add(request: PendingRequest): void {
    if (this.entries.has(request.id)) return
    this.entries.set(request.id, request.app ? { ...request, choices: appChoices(request.choices) } : request)
    this.notify()
  }

  settle(id: string, reason: SettleReason): void {
    const entry = this.entries.get(id)
    if (!entry || entry.settled) return
    const settled = { ...entry, settled: reason, settledAt: this.now() }
    this.entries.set(id, settled)
    for (const listener of [...this.settleListeners]) listener(settled)
    this.notify()
  }

  /** Record the delivery state of an answer (never the answer itself). No-op once settled. */
  markAnswer(id: string, state: 'answering' | 'failed', error?: string): void {
    const entry = this.entries.get(id)
    if (!entry || entry.settled) return
    const { answerError: _drop, ...rest } = entry
    this.entries.set(id, { ...rest, answerState: state, ...(error ? { answerError: error } : {}) })
    this.notify()
  }

  /**
   * The owner of `sessionId` became known (roster or resume): fix unsettled entries first seen
   * before the mapping existed. Immutable update, one notification.
   */
  repairProfile(sessionId: string, profile: string): void {
    let changed = false
    for (const [id, entry] of this.entries) {
      if (entry.settled || entry.profile !== 'unknown' || entry.sessionId !== sessionId) continue
      this.entries.set(id, { ...entry, profile })
      changed = true
    }
    if (changed) this.notify()
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

  /**
   * Resume replays the server requests Hermes still holds for a session. Server-request entries
   * (srq-…) of those sessions that are absent were answered, withdrawn or expired meanwhile.
   */
  reconcileRequests(sessionIds: readonly string[], liveIds: ReadonlySet<string>, requestedAt: number): void {
    for (const entry of this.list()) {
      const requestBased = entry.source === 'server_request' || entry.source === 'open_request'
      if (requestBased && sessionIds.includes(entry.sessionId) && !liveIds.has(entry.id) && entry.receivedAt < requestedAt) {
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
