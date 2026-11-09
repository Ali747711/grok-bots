import type { BotView } from '@/state/types'
import type { GatewayEvent } from '@/vendor/hermes/gateway-events'
import { JsonRpcGatewayError } from '@/vendor/hermes/json-rpc-channel'

import { fetchHistory, openBotChat, type HistoryResult, type OpenedChat, type RpcClient } from './open-bot-chat'
import { applyFrame, initialTurnState, type TurnFrame, type TurnState } from './turn-reducer'
import type { ChatItem } from './types'

export type AdmissionResult = 'queued' | 'started' | 'duplicate' | 'lost' | 'uncertain' | 'not_sent'

/** What ChatSession needs from the vendored gateway client. */
export interface ChatClient extends RpcClient {
  onAny(handler: (event: GatewayEvent) => void): () => void
  onState(handler: (state: string) => void): () => void
  /** Resolves true once the client's reconnect replay for the session has dispatched; false when the socket was lost. */
  sessionReplayBarrier?(sessionId: string): Promise<boolean> | undefined
}

type UserItem = Extract<ChatItem, { kind: 'user' }>

/** A sent message whose delivery is not settled yet. */
interface Submission {
  text: string
  status: 'checking' | 'not_sent'
  /** Resolves a still-"checking" message to "couldn't confirm" so it never waits forever. */
  timer?: ReturnType<typeof setTimeout>
}

/** `send` = first attempt; `resubmit` = the single automatic re-ask under the same id; `retry` = the user's button. */
type Attempt = 'send' | 'resubmit' | 'retry'

const SUBMIT_TIMEOUT_MS = 1_800_000
const RETRY_MIN_MS = 1000
const RETRY_MAX_MS = 15_000
const RECONNECTING = 'Reconnecting to the chat…'
const CONFIRM_TIMEOUT_MS = 30_000
const UNCONFIRMED = 'Not sent — couldn’t confirm delivery'
const backoff = (attempt: number) => Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** A short plain-words reason: codes lose their underscores and raw JSON is never shown. */
function plainReason(error: unknown): string {
  const text = reason(error).trim()
  if (!text || /^[[{]/.test(text)) return 'unexpected error'
  return text.replace(/_/g, ' ').slice(0, 120)
}

/** Map the admission status Hermes returns for `prompt.submit` (terminal = already handled, unknown = lost). */
function toAdmission(status: unknown): AdmissionResult {
  if (status === 'terminal') return 'duplicate'
  if (status === 'unknown') return 'lost'
  return status === 'queued' ? 'queued' : 'started'
}

/**
 * One bot's chat on the shared gateway connection: opens (resumes) the canonical chat, loads history,
 * folds live events through the turn reducer, sends and stops, and re-subscribes after a reconnect.
 */
export class ChatSession {
  /** History plus turns already folded in. */
  private base: readonly ChatItem[] = []
  /** The live turn. Never reset or frozen while its generation runs. */
  private turn: TurnState = initialTurnState
  /** Messages and notices added while a turn may still be running; shown below the turn, folded in when the next generation starts. */
  private pending: readonly ChatItem[] = []
  private _error: string | null = null
  private retryToken = 0
  private _sessionId: string | null = null
  /** Highest generation seen for the CURRENT session id only. */
  private maxGeneration = 0
  private ready = false
  /** History for `_sessionId` has been loaded into `base`. */
  private hydrated = false
  private socketUp = true
  private attached = false
  private openToken = 0
  /** Live events are parked here while history loads, then reconciled with the stored rows. */
  private loading = false
  private buffer: TurnFrame[] = []
  private noticeCount = 0
  private readonly submissions = new Map<string, Submission>()
  private readonly listeners = new Set<(items: readonly ChatItem[]) => void>()
  private detach: (() => void)[] = []

  constructor(
    private readonly client: ChatClient,
    private readonly bot: BotView,
    private readonly options: { retryDelayMs?: (attempt: number) => number; confirmTimeoutMs?: number } = {}
  ) {}

  get sessionId(): string | null { return this._sessionId }
  get canSend(): boolean { return this.ready && this.socketUp }
  /** The gateway socket is up (independent of whether the chat has been re-opened yet). */
  get connected(): boolean { return this.socketUp }
  get running(): boolean { return this.turn.running }
  get items(): readonly ChatItem[] { return [...this.base, ...this.turn.items, ...this.pending] }
  /** Set while the chat is being re-opened after a reconnect; null otherwise. */
  get error(): string | null { return this._error }

  subscribe(listener: (items: readonly ChatItem[]) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Open the chat and start listening. Rejects when it cannot be opened (nothing is created on a failed resume). */
  async open(): Promise<void> {
    this.attach()
    await this.reopen()
  }

  /** Stop listening. The Hermes session stays subscribed (no `session.detach`). */
  close(): void {
    this.openToken += 1
    this.retryToken += 1
    this.ready = false
    this.attached = false
    for (const record of this.submissions.values()) clearTimeout(record.timer)
    for (const off of this.detach) off()
    this.detach = []
  }

  async send(text: string): Promise<AdmissionResult> {
    const sessionId = this._sessionId
    if (!this.canSend || !sessionId) throw new Error('Not connected to Hermes')
    const submissionId = crypto.randomUUID()
    this.submissions.set(submissionId, { text, status: 'checking' })
    this.pending = [...this.pending, { kind: 'user', id: `user-${submissionId}`, text, submissionId }]
    this.emit()
    return this.attempt(submissionId, sessionId, 'send')
  }

  /** Ask again under the SAME submission id; Hermes answers with the admission it already holds, so the prompt runs once. */
  async retry(submissionId: string): Promise<AdmissionResult> {
    const record = this.submissions.get(submissionId)
    if (!record) throw new Error('That message is no longer waiting')
    const sessionId = this._sessionId
    if (!this.canSend || !sessionId) {
      this.markNotSent(submissionId, 'Not sent — not connected to Hermes')
      return 'not_sent'
    }
    this.markChecking(submissionId)
    return this.attempt(submissionId, sessionId, 'retry')
  }

  async stop(): Promise<void> {
    if (!this._sessionId) return
    try {
      await this.client.request('session.interrupt', {
        profile: this.bot.name,
        session_id: this._sessionId,
        execution_generation: this.maxGeneration
      })
    } catch (error) {
      this.addNotice(`Couldn’t stop — ${plainReason(error)}`)
    }
  }

  private async attempt(submissionId: string, sessionId: string, mode: Attempt): Promise<AdmissionResult> {
    const record = this.submissions.get(submissionId)
    if (!record) return 'started'
    try {
      const result = await this.client.request<{ status?: unknown } | undefined>(
        'prompt.submit',
        { profile: this.bot.name, session_id: sessionId, text: record.text, submission_id: submissionId },
        SUBMIT_TIMEOUT_MS
      )
      this.settle(submissionId)
      const admission = toAdmission(result?.status)
      // For a re-ask, "duplicate" means the first attempt did land, so the message stays.
      if (admission === 'duplicate' && mode === 'send') this.replaceItem(`user-${submissionId}`, null)
      else this.setDelivery(submissionId, undefined)
      if (admission === 'lost') this.pending = [...this.pending, { kind: 'notice', id: `lost-${submissionId}`, text: 'This message was lost when Hermes restarted' }]
      this.emit()
      return admission
    } catch (error) {
      return this.attemptFailed(error, submissionId, mode)
    }
  }

  private attemptFailed(error: unknown, submissionId: string, mode: Attempt): AdmissionResult {
    const refused = error instanceof JsonRpcGatewayError
    if (refused && mode === 'send') {
      // Hermes answered with a definite refusal of the first attempt.
      this.settle(submissionId)
      this.replaceItem(`user-${submissionId}`, { kind: 'notice', id: `notice-user-${submissionId}`, text: `Not sent: ${reason(error)}` })
      this.emit()
      throw error
    }
    if (refused) {
      this.markNotSent(submissionId, `Not sent: ${reason(error)}`)
      return 'not_sent'
    }
    // Socket closed or timed out on the first attempt: ask again once under the same id.
    if (mode === 'send') {
      this.markChecking(submissionId)
      if (this.socketUp && this._sessionId) void this.attempt(submissionId, this._sessionId, 'resubmit')
      return 'uncertain'
    }
    this.markNotSent(submissionId, UNCONFIRMED)
    return 'not_sent'
  }

  private markChecking(submissionId: string): void {
    const record = this.submissions.get(submissionId)
    if (!record) return
    clearTimeout(record.timer)
    record.status = 'checking'
    record.timer = setTimeout(() => {
      if (record.status === 'checking') this.markNotSent(submissionId, UNCONFIRMED)
    }, this.options.confirmTimeoutMs ?? CONFIRM_TIMEOUT_MS)
    this.setDelivery(submissionId, 'checking')
    this.emit()
  }

  private markNotSent(submissionId: string, text: string): void {
    const record = this.submissions.get(submissionId)
    if (!record) return
    clearTimeout(record.timer)
    record.status = 'not_sent'
    this.setDelivery(submissionId, 'not_sent', text)
    this.emit()
  }

  private settle(submissionId: string): void {
    clearTimeout(this.submissions.get(submissionId)?.timer)
    this.submissions.delete(submissionId)
  }

  /** Re-ask every message still "checking", once each, before Send is enabled again. */
  private async resubmitChecking(sessionId: string): Promise<void> {
    for (const [id, record] of [...this.submissions]) {
      if (record.status === 'checking') await this.attempt(id, sessionId, 'resubmit')
    }
  }

  /** The re-open failed: nothing may stay "checking", so resolve what is left to "couldn't confirm". */
  private resolveUnconfirmed(): void {
    for (const [id, record] of this.submissions) if (record.status === 'checking') this.markNotSent(id, UNCONFIRMED)
  }

  private attach(): void {
    if (this.attached) return
    this.attached = true
    this.detach = [
      this.client.onAny(event => this.onEvent(event)),
      this.client.onState(state => this.onState(state))
    ]
  }

  private onState(state: string): void {
    if (!this.attached) return
    const open = state === 'open'
    const wasConnected = this.socketUp
    this.socketUp = open
    if (state === 'closed' || state === 'error') this.ready = false
    if (open && !wasConnected) void this.reopenWithRetry()
    this.emit()
  }

  private onEvent(event: TurnFrame): void {
    if (!this.attached || !this._sessionId || event.session_id !== this._sessionId) return
    if (this.loading) {
      this.buffer.push(event)
      return
    }
    this.handleEvent(event)
  }

  private handleEvent(event: TurnFrame): void {
    this.noteGeneration(num(event.execution_generation))
    if (event.type === 'session.info') this.noteGeneration(num((event.payload as { execution_generation?: unknown } | null)?.execution_generation))
    if (event.type === 'session.replay_gap') {
      void this.reopenWithRetry(true)
      return
    }
    this.foldBeforeNextTurn(event)
    const next = applyFrame(this.turn, event)
    if (next === this.turn) return
    this.turn = next
    this.emit()
  }

  private noteGeneration(g: number | undefined): void {
    if (g !== undefined && g > this.maxGeneration) this.maxGeneration = g
  }

  /** A new generation starts after the previous turn finished: move that turn and the queued items into `base`. */
  private foldBeforeNextTurn(event: TurnFrame): void {
    const g = num(event.execution_generation)
    if (event.type !== 'message.start' || this.turn.running || (g !== undefined && g <= this.turn.generation)) return
    this.base = [...this.base, ...this.turn.items, ...this.pending]
    this.pending = []
    this.turn = { ...initialTurnState, generation: this.turn.generation }
  }

  /** Re-open, retrying with backoff while the connection is up, so a failed resume never leaves the chat dead. */
  private async reopenWithRetry(fresh = false): Promise<void> {
    const mine = ++this.retryToken
    for (let attempt = 0; ; attempt += 1) {
      try {
        await this.reopen(fresh)
        if (mine === this.retryToken) { this._error = null; this.emit() }
        return
      } catch {
        this.resolveUnconfirmed()
        if (mine !== this.retryToken || !this.attached || !this.socketUp) return
        this._error = RECONNECTING
        this.emit()
        await new Promise(resolve => setTimeout(resolve, (this.options.retryDelayMs ?? backoff)(attempt)))
        if (mine !== this.retryToken || !this.socketUp) return
      }
    }
  }

  /** Wait for the client's reconnect replay so older frames land before the snapshot moves the generation on. */
  private async awaitReplay(...sessionIds: (string | null)[]): Promise<void> {
    for (const id of new Set(sessionIds.filter((s): s is string => s !== null))) {
      if ((await this.client.sessionReplayBarrier?.(id)) === false) throw new Error('connection lost before the replay finished')
    }
  }

  /**
   * (Re-)resume. The returned session id can differ from the last one (compression).
   * Same id with history already loaded (and not `fresh`): keep the live turn and history; the client's
   * replay plus the reducer's de-duping cover the gap, so only running/generation refresh from the snapshot.
   * New id, never hydrated, or replay gap: reset the turn and reload history, parking live events meanwhile.
   */
  private async reopen(fresh = false): Promise<void> {
    const token = ++this.openToken
    this.ready = false
    const opened: OpenedChat = await openBotChat(this.client, this.bot)
    if (token !== this.openToken) return
    await this.awaitReplay(this._sessionId, opened.sessionId)
    if (token !== this.openToken) return
    const sameId = this._sessionId === opened.sessionId
    this._sessionId = opened.sessionId
    this.maxGeneration = sameId ? Math.max(this.maxGeneration, opened.generation) : opened.generation
    if (sameId && this.hydrated && !fresh) {
      this.turn = { ...this.turn, generation: Math.max(this.turn.generation, opened.generation), running: opened.running }
      await this.resubmitChecking(opened.sessionId)
      if (token !== this.openToken) return
      this.ready = true
      this.emit()
      return
    }
    await this.hydrate(token, opened)
  }

  private async hydrate(token: number, opened: OpenedChat): Promise<void> {
    this.hydrated = false
    this.turn = { ...initialTurnState, generation: opened.generation, running: opened.running }
    this.pending = this.pending.filter(i => i.kind === 'user' && i.delivery !== undefined)
    this.buffer = []
    this.loading = true
    let history: HistoryResult
    try {
      history = await fetchHistory(this.bot.name, opened.sessionId)
    } catch (error) {
      if (token === this.openToken) this.drainBuffer(null)
      throw error
    }
    if (token !== this.openToken) return
    this.base = history.items
    this.dropStoredLocalMessages(history.items)
    this.drainBuffer(history.rowIds)
    this.hydrated = true
    await this.resubmitChecking(opened.sessionId)
    if (token !== this.openToken) return
    this.ready = true
    this.emit()
  }

  /** A local message the stored transcript already holds (same submission id) is dropped: the stored row wins and the message is settled. */
  private dropStoredLocalMessages(stored: readonly ChatItem[]): void {
    const ids = new Set(stored.flatMap(i => (i.kind === 'user' && i.submissionId ? [i.submissionId] : [])))
    if (ids.size === 0) return
    this.pending = this.pending.filter(i => !(i.kind === 'user' && i.submissionId && ids.has(i.submissionId)))
    for (const id of ids) if (this.submissions.has(id)) this.settle(id)
  }

  /** Apply parked live events, skipping turns whose rows the stored transcript already holds. */
  private drainBuffer(stored: ReadonlySet<number> | null): void {
    const events = this.buffer
    this.buffer = []
    this.loading = false
    const persisted = new Set<number | undefined>()
    for (const e of events) {
      const rows = (e.payload as { persisted_turn?: { row_ids?: unknown } } | null)?.persisted_turn?.row_ids
      if (e.type === 'message.complete' && stored && Array.isArray(rows) && rows.some(r => typeof r === 'number' && stored.has(r))) persisted.add(e.execution_generation)
    }
    for (const e of events) {
      if (e.type === 'session.replay_gap') continue
      if (!persisted.has(e.execution_generation)) this.handleEvent(e)
      else if (e.type === 'message.complete') this.finishPersistedTurn(e)
    }
  }

  /** The turn is already in the stored transcript: only record that it ended (no text again), so the chat is not stuck "running". */
  private finishPersistedTurn(event: TurnFrame): void {
    const g = num(event.execution_generation) ?? this.turn.generation
    this.noteGeneration(g)
    this.turn = {
      ...this.turn,
      generation: Math.max(this.turn.generation, g),
      running: false,
      textOpen: false,
      status: null,
      started: [...this.turn.started, g],
      completed: [...this.turn.completed, g]
    }
  }

  private setDelivery(submissionId: string, delivery: 'checking' | 'not_sent' | undefined, reasonText?: string): void {
    const update = (items: readonly ChatItem[]) => items.map((i): ChatItem => {
      if (i.kind !== 'user' || i.submissionId !== submissionId) return i
      const { delivery: _d, reason: _r, ...rest } = i
      return (delivery ? { ...rest, delivery, ...(reasonText ? { reason: reasonText } : {}) } : rest) as UserItem
    })
    this.base = update(this.base)
    this.pending = update(this.pending)
  }

  private replaceItem(id: string, replacement: ChatItem | null): void {
    const swap = (items: readonly ChatItem[]) => items.flatMap(i => (i.id === id ? (replacement ? [replacement] : []) : [i]))
    this.base = swap(this.base)
    this.pending = swap(this.pending)
  }

  private addNotice(text: string): void {
    this.noticeCount += 1
    this.pending = [...this.pending, { kind: 'notice', id: `notice-local-${this.noticeCount}`, text }]
    this.emit()
  }

  private emit(): void {
    const items = this.items
    for (const listener of [...this.listeners]) listener(items)
  }
}
