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
  private base: readonly ChatItem[] = []
  private turn: TurnState = initialTurnState
  private _sessionId: string | null = null
  private maxGeneration = 0
  private ready = false
  private connected = true
  private attached = false
  private openToken = 0
  private readonly listeners = new Set<(items: readonly ChatItem[]) => void>()
  private detach: (() => void)[] = []

  constructor(private readonly client: ChatClient, private readonly bot: BotView) {}

  get sessionId(): string | null { return this._sessionId }
  get canSend(): boolean { return this.ready && this.connected }
  get running(): boolean { return this.turn.running }
  get items(): readonly ChatItem[] { return [...this.base, ...this.turn.items] }

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
    // Earlier turns move into `base` so the new user message lands after them.
    this.base = [...this.base, ...this.turn.items, { kind: 'user', id: userId, text }]
    this.turn = { ...initialTurnState, generation: this.turn.generation, running: this.turn.running }
    this.emit()
    try {
      const result = await this.client.request<{ status?: unknown } | undefined>(
        'prompt.submit',
        { profile: this.bot.name, session_id: sessionId, text, submission_id: submissionId, surface: 'hud' },
        SUBMIT_TIMEOUT_MS
      )
      const admission = toAdmission(result?.status)
      if (admission === 'duplicate') this.replaceUser(userId, null)
      if (admission === 'lost') this.addNotice(`lost-${submissionId}`, 'This message was lost when Hermes restarted')
      this.emit()
      return admission
    } catch (error) {
      this.replaceUser(userId, { kind: 'notice', id: `notice-${userId}`, text: `Not sent: ${reason(error)}` })
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
    if (open && !wasConnected) void this.reopen().catch(() => undefined)
    this.emit()
  }

  private onEvent(event: TurnFrame): void {
    if (!this.attached || !this._sessionId || event.session_id !== this._sessionId) return
    this.noteGeneration(num(event.execution_generation))
    if (event.type === 'session.info') this.noteGeneration(num((event.payload as { execution_generation?: unknown } | null)?.execution_generation))
    const next = applyFrame(this.turn, event)
    if (next === this.turn) return
    this.turn = next
    this.emit()
  }

  private noteGeneration(g: number | undefined): void {
    if (g !== undefined && g > this.maxGeneration) this.maxGeneration = g
  }

  /** (Re-)resume, then load history. The returned session id can differ from the last one (compression). */
  private async reopen(): Promise<void> {
    const token = ++this.openToken
    this.ready = false
    const opened: OpenedChat = await openBotChat(this.client, this.bot)
    if (token !== this.openToken) return
    this._sessionId = opened.sessionId
    this.maxGeneration = Math.max(this.maxGeneration, opened.generation)
    this.turn = { ...initialTurnState, generation: opened.generation, running: opened.running }
    const history = await fetchHistory(this.bot.name, opened.sessionId)
    if (token !== this.openToken) return
    this.base = history
    this.ready = true
    this.emit()
  }

  private replaceUser(userId: string, replacement: ChatItem | null): void {
    this.base = this.base.flatMap(i => (i.id === userId ? (replacement ? [replacement] : []) : [i]))
  }

  private addNotice(id: string, text: string): void {
    this.base = [...this.base, ...this.turn.items, { kind: 'notice', id, text }]
    this.turn = { ...this.turn, items: [] }
  }

  private emit(): void {
    const items = this.items
    for (const listener of [...this.listeners]) listener(items)
  }
}
