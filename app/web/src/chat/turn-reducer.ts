import type { ChatItem } from './types'
import { applyToolFrame, finishWork, type ToolPayload } from './turn-steps'

/** A gateway event as the vendored client delivers it (structural subset of `GatewayEvent`). */
export interface TurnFrame {
  type: string
  payload?: unknown
  execution_generation?: number
  seq?: number
  replayed?: boolean
  session_id?: string
}

export interface TurnState {
  items: readonly ChatItem[]
  /** Highest execution generation seen; frames below it are stale. */
  generation: number
  running: boolean
  /** End offset already applied per `turn_id:segment`, so replayed text is not appended twice. */
  cursor: Record<string, number>
  /** Transient label ("Thinking…", "Preparing terminal…"); never part of the transcript. */
  status: string | null
  /** True while the last assistant item still receives deltas (a `{text: null}` frame closes it). */
  textOpen: boolean
}

export const initialTurnState: TurnState = { items: [], generation: 0, running: false, cursor: {}, status: null, textOpen: false }

interface DeltaPayload { text?: string | null; turn_id?: string; segment?: number; offset?: number }
interface CompletePayload {
  text?: string | null
  rendered?: string | null
  status?: string
  outcome?: string
  interrupted?: boolean
  error_surface?: unknown
}

const workId = (g: number) => `work-${g}`
const assistantPrefix = (g: number) => `assistant-${g}-`
const countWithPrefix = (items: readonly ChatItem[], prefix: string) => items.filter(i => i.id.startsWith(prefix)).length
const noticeId = (items: readonly ChatItem[], g: number) => `notice-${g}-${countWithPrefix(items, `notice-${g}-`)}`

function startTurn(state: TurnState, g: number): TurnState {
  if (state.items.some(i => i.id === workId(g))) return state
  const items: ChatItem[] = [
    ...state.items,
    { kind: 'work', id: workId(g), steps: [] },
    { kind: 'assistant', id: `${assistantPrefix(g)}0`, text: '' }
  ]
  return { ...state, items, generation: g, running: true, textOpen: true, status: null }
}

function appendText(state: TurnState, text: string): TurnState {
  const last = state.items.at(-1)
  const g = state.generation
  if (state.textOpen && last?.kind === 'assistant' && last.id.startsWith(assistantPrefix(g))) {
    return { ...state, items: [...state.items.slice(0, -1), { ...last, text: last.text + text }] }
  }
  const id = `${assistantPrefix(g)}${countWithPrefix(state.items, assistantPrefix(g))}`
  return { ...state, items: [...state.items, { kind: 'assistant', id, text }], textOpen: true }
}

function applyDelta(state: TurnState, frame: TurnFrame): TurnState {
  const { text, turn_id: turnId, segment, offset } = (frame.payload ?? {}) as DeltaPayload
  if (text === null) return { ...state, textOpen: false }
  if (typeof text !== 'string' || text === '') return state
  if (turnId === undefined || offset === undefined) return frame.replayed ? state : { ...appendText(state, text), status: null }
  const key = `${turnId}:${segment ?? 0}`
  const seen = state.cursor[key] ?? 0
  const end = offset + text.length
  if (end <= seen) return state
  const fresh = offset < seen ? text.slice(seen - offset) : text
  return { ...appendText(state, fresh), cursor: { ...state.cursor, [key]: end }, status: null }
}

function errorText(surface: unknown): string {
  if (typeof surface === 'string' && surface) return surface
  const message = (surface as { message?: unknown } | null)?.message
  return typeof message === 'string' && message ? message : 'The turn failed'
}

function applyComplete(state: TurnState, payload: CompletePayload): TurnState {
  const g = state.generation
  const final = (payload.text ?? payload.rendered ?? '').trim()
  let items = finishWork(state.items)
  const at = items.findLastIndex(i => i.kind === 'assistant' && i.id.startsWith(assistantPrefix(g)))
  if (final) {
    const target = items[at]
    items = target?.kind === 'assistant'
      ? items.map((i, n) => (n === at ? { ...target, text: final } : i))
      : [...items, { kind: 'assistant', id: `${assistantPrefix(g)}${countWithPrefix(items, assistantPrefix(g))}`, text: final }]
  }
  items = items.filter(i => !(i.kind === 'assistant' && i.id.startsWith(assistantPrefix(g)) && i.text.trim() === ''))
  const interrupted = payload.interrupted === true || payload.status === 'interrupted' || payload.outcome === 'interrupted'
  const failed = payload.status === 'error'
  if (interrupted || failed) {
    const text = interrupted ? 'Stopped' : errorText(payload.error_surface)
    const done = items.some(i => i.kind === 'notice' && i.text === text && i.id.startsWith(`notice-${g}-`))
    if (!done) items = [...items, { kind: 'notice', id: noticeId(items, g), text }]
  }
  return { ...state, items, running: false, textOpen: false, status: null }
}

function applyInterim(state: TurnState, payload: { text?: string | null; rendered?: string | null }): TurnState {
  const text = (payload.text ?? payload.rendered ?? '').trim()
  if (!text) return state
  const g = state.generation
  const trimmed = state.items.filter(i => !(i.kind === 'assistant' && i.id.startsWith(assistantPrefix(g)) && i.text === '' && i === state.items.at(-1)))
  const id = `${assistantPrefix(g)}${countWithPrefix(trimmed, assistantPrefix(g))}`
  return { ...state, items: [...trimmed, { kind: 'assistant', id, text }], textOpen: false }
}

/** Pure reducer: one gateway frame in, next turn state out. Older generations and `agent.step` are ignored. */
export function applyFrame(state: TurnState, frame: TurnFrame): TurnState {
  const g = frame.execution_generation
  if (g !== undefined && g < state.generation) return state
  const base = g !== undefined && g > state.generation ? { ...state, generation: g } : state
  const payload = frame.payload ?? {}
  switch (frame.type) {
    case 'message.start':
      return startTurn(base, g ?? base.generation)
    case 'message.delta':
      return applyDelta(base, frame)
    case 'message.interim':
      return applyInterim(base, payload as { text?: string })
    case 'tool.start':
    case 'tool.progress':
    case 'tool.complete':
      return { ...base, status: null, items: applyToolFrame(base.items, workId(base.generation), frame.type, payload as ToolPayload) }
    case 'tool.generating':
      return { ...base, status: `Preparing ${(payload as { name?: string }).name ?? 'tool'}…` }
    case 'thinking.delta':
      return (payload as { text?: string }).text ? { ...base, status: 'Thinking…' } : base
    case 'message.complete':
      return applyComplete(base, payload as CompletePayload)
    default:
      return state
  }
}
