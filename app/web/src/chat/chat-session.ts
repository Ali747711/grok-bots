import type { BotView } from '@/state/types'
import type { GatewayEvent } from '@/vendor/hermes/gateway-events'

import { fetchHistory, openBotChat, type OpenedChat, type RpcClient } from './open-bot-chat'
import { applyFrame, initialTurnState, type TurnFrame, type TurnState } from './turn-reducer'
import type { ChatItem } from './types'

export type AdmissionResult = 'queued' | 'started' | 'duplicate' | 'lost'

/** What ChatSession needs from the vendored gateway client. */
export interface ChatClient extends RpcClient {
  onAny(handler: (event: GatewayEvent) => void): () => void
  onState(handler: (state: string) => void): () => void
}

const SUBMIT_TIMEOUT_MS = 1_800_000
const RETRY_MIN_MS = 1000
const RETRY_MAX_MS = 15_000
const RECONNECTING = 'Reconnecting to the chat…'
const backoff = (attempt: number) => Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

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
  private maxGeneration = 0
  private ready = false
  private connected = true
  private attached = false
  private openToken = 0
  private readonly listeners = new Set<(items: readonly ChatItem[]) => void>()
  private detach: (() => void)[] = []

  constructor(
    private readonly client: ChatClient,
    private readonly bot: BotView,
    private readonly options: { retryDelayMs?: (attempt: number) => number } = {}
  ) {}

  get sessionId(): string | null { return this._sessionId }
  get canSend(): boolean { return this.ready && this.connected }
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
    for (const off of this.detach) off()
    this.detach = []
  }

  async send(text: string): Promise<AdmissionResult> {
    const sessionId = this._sessionId
    if (!this.canSend || !sessionId) throw new Error('Not connected to Hermes')
    const submissionId = crypto.randomUUID()
    const userId = `user-${submissionId}`
    this.pending = [...this.pending, { kind: 'user', id: userId, text }]
    this.emit()
    try {
      const result = await this.client.request<{ status?: unknown } | undefined>(
        'prompt.submit',
        { profile: this.bot.name, session_id: sessionId, text, submission_id: submissionId, surface: 'hud' },
        SUBMIT_TIMEOUT_MS
      )
      const admission = toAdmission(result?.status)
      if (admission === 'duplicate') this.replaceItem(userId, null)
      if (admission === 'lost') this.pending = [...this.pending, { kind: 'notice', id: `lost-${submissionId}`, text: 'This message was lost when Hermes restarted' }]
      this.emit()
      return admission
    } catch (error) {
      this.replaceItem(userId, { kind: 'notice', id: `notice-${userId}`, text: `Not sent: ${reason(error)}` })
      this.emit()
      throw error
    }
  }

  async stop(): Promise<void> {
    if (!this._sessionId) return
    await this.client.request('session.interrupt', {
      profile: this.bot.name,
      session_id: this._sessionId,
      execution_generation: this.maxGeneration
    })
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
    const wasConnected = this.connected
    this.connected = open
    if (state === 'closed' || state === 'error') this.ready = false
    if (open && !wasConnected) void this.reopenWithRetry()
    this.emit()
  }

  private onEvent(event: TurnFrame): void {
    if (!this.attached || !this._sessionId || event.session_id !== this._sessionId) return
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
        if (mine !== this.retryToken || !this.attached || !this.connected) return
        this._error = RECONNECTING
        this.emit()
        await new Promise(resolve => setTimeout(resolve, (this.options.retryDelayMs ?? backoff)(attempt)))
        if (mine !== this.retryToken || !this.connected) return
      }
    }
  }

  /**
   * (Re-)resume. The returned session id can differ from the last one (compression).
   * Same id and not `fresh`: keep the live turn and history (the client's replay plus the reducer's
   * de-duping already cover the gap, and reloading history would duplicate the live turn); only refresh
   * running/generation from the snapshot. New id, first open or replay gap: reset the turn and reload history.
   */
  private async reopen(fresh = false): Promise<void> {
    const token = ++this.openToken
    this.ready = false
    const opened: OpenedChat = await openBotChat(this.client, this.bot)
    if (token !== this.openToken) return
    const same = !fresh && this._sessionId === opened.sessionId
    this._sessionId = opened.sessionId
    this.maxGeneration = Math.max(this.maxGeneration, opened.generation)
    if (same) {
      this.turn = { ...this.turn, generation: Math.max(this.turn.generation, opened.generation), running: opened.running }
      this.ready = true
      this.emit()
      return
    }
    this.turn = { ...initialTurnState, generation: opened.generation, running: opened.running }
    this.pending = []
    const history = await fetchHistory(this.bot.name, opened.sessionId)
    if (token !== this.openToken) return
    this.base = history
    this.ready = true
    this.emit()
  }

  private replaceItem(id: string, replacement: ChatItem | null): void {
    const swap = (items: readonly ChatItem[]) => items.flatMap(i => (i.id === id ? (replacement ? [replacement] : []) : [i]))
    this.base = swap(this.base)
    this.pending = swap(this.pending)
  }

  private emit(): void {
    const items = this.items
    for (const listener of [...this.listeners]) listener(items)
  }
}
