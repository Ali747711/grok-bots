import type { ChatItem } from './types'
import { applyToolFrame, finishWork, markInterrupted, type ToolPayload } from './turn-steps'

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
  /** Generations whose `message.start` / `message.complete` were applied, so a replay is a no-op. */
  started: readonly number[]
  completed: readonly number[]
  /** `turn_id:segment` keys of interim seals already handled (a re-sent seal is not a new bubble). */
  sealed: readonly string[]
  /** Counter behind assistant item ids; ids are never reused. */
  nextItem: number
}

export const initialTurnState: TurnState = {
  items: [], generation: 0, running: false, cursor: {}, status: null, textOpen: false, started: [], completed: [], sealed: [], nextItem: 0
}

interface DeltaPayload { text?: string | null; turn_id?: string; segment?: number; offset?: number }
interface InterimPayload { text?: string | null; already_streamed?: boolean; turn_id?: string | null; segment?: number | null }
/** The subset of MessageCompletePayload (gateway-contract) Crew reads. */
interface CompletePayload {
  text?: unknown
  rendered?: string | null
  status?: string | null
  outcome?: string
  interrupted?: boolean
  error?: string | null
  failure_reason?: string | null
  error_surface?: { code?: unknown } | null
}

const workId = (g: number) => `work-${g}`
const assistantPrefix = (g: number) => `assistant-${g}-`
const countWithPrefix = (items: readonly ChatItem[], prefix: string) => items.filter(i => i.id.startsWith(prefix)).length
const newAssistantId = (state: TurnState) => `${assistantPrefix(state.generation)}${state.nextItem}`
const noticeId = (items: readonly ChatItem[], g: number) => `notice-${g}-${countWithPrefix(items, `notice-${g}-`)}`

function startTurn(state: TurnState, g: number): TurnState {
  if (state.started.includes(g)) return state
  const items: ChatItem[] = [
    ...state.items,
    { kind: 'work', id: workId(g), steps: [] },
    { kind: 'assistant', id: `${assistantPrefix(g)}${state.nextItem}`, text: '' }
  ]
  return { ...state, items, generation: g, running: true, textOpen: true, status: null, started: [...state.started, g], nextItem: state.nextItem + 1 }
}

function appendText(state: TurnState, text: string): TurnState {
  const last = state.items.at(-1)
  const g = state.generation
  if (state.textOpen && last?.kind === 'assistant' && last.id.startsWith(assistantPrefix(g))) {
    return { ...state, items: [...state.items.slice(0, -1), { ...last, text: last.text + text }] }
  }
  return { ...state, items: [...state.items, { kind: 'assistant', id: newAssistantId(state), text }], textOpen: true, nextItem: state.nextItem + 1 }
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

/** Human text first (`error`, `failure_reason`), then the advisory surface code; never invented wording. */
function errorText(payload: CompletePayload): string {
  const candidates = [payload.error, payload.failure_reason, payload.error_surface?.code]
  return candidates.find((c): c is string => typeof c === 'string' && c.length > 0) ?? 'The turn failed'
}

function applyComplete(state: TurnState, payload: CompletePayload): TurnState {
  const g = state.generation
  if (state.completed.includes(g)) return state
  const final = (typeof payload.text === 'string' ? payload.text : payload.rendered ?? '').trim()
  let items = finishWork(state.items)
  const at = items.findLastIndex(i => i.kind === 'assistant' && i.id.startsWith(assistantPrefix(g)))
  if (final) {
    const target = items[at]
    const sameText = target?.kind === 'assistant' && target.text.trim() === final
    // Only the still-open segment is the final answer. A closed or sealed one (commentary) is kept as is.
    if (target?.kind === 'assistant' && state.textOpen) items = items.map((i, n) => (n === at ? { ...target, text: final } : i))
    else if (!sameText) items = [...items, { kind: 'assistant', id: newAssistantId(state), text: final }]
  }
  items = items.filter(i => !(i.kind === 'assistant' && i.id.startsWith(assistantPrefix(g)) && i.text.trim() === ''))
  const interrupted = payload.interrupted === true || payload.status === 'interrupted' || payload.outcome === 'interrupted'
  const failed = payload.status === 'error'
  if (interrupted) items = markInterrupted(items, workId(g))
  if (interrupted || failed) {
    const text = interrupted ? 'Stopped' : errorText(payload)
    items = [...items, { kind: 'notice', id: noticeId(items, g), text }]
  }
  return { ...state, items, running: false, textOpen: false, status: null, completed: [...state.completed, g], nextItem: state.nextItem + 1 }
}

/** `already_streamed`: the text arrived as deltas, so only seal the open item. Otherwise add it once per segment. */
function applyInterim(state: TurnState, payload: InterimPayload): TurnState {
  const key = typeof payload.turn_id === 'string' ? `${payload.turn_id}:${payload.segment ?? 0}` : null
  if (key && state.sealed.includes(key)) return state
  const sealed = key ? [...state.sealed, key] : state.sealed
  if (payload.already_streamed) return { ...state, textOpen: false, sealed }
  const text = (payload.text ?? '').trim()
  if (!text) return { ...state, sealed }
  const last = state.items.at(-1)
  const emptyOpen = last?.kind === 'assistant' && last.text === '' && last.id.startsWith(assistantPrefix(state.generation))
  const items = emptyOpen ? state.items.slice(0, -1) : state.items
  return {
    ...state,
    items: [...items, { kind: 'assistant', id: newAssistantId(state), text }],
    textOpen: false, sealed, nextItem: state.nextItem + 1
  }
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
      return applyInterim(base, payload as InterimPayload)
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
