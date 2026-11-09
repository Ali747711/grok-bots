import type { ChatItem, WorkStep } from './types'

type WorkItem = Extract<ChatItem, { kind: 'work' }>

/** Fields of tool.start / tool.progress / tool.complete payloads Crew reads. */
export interface ToolPayload {
  tool_id?: string
  tool_call_id?: string
  name?: string
  tool_name?: string
  context?: string
  is_error?: boolean
  result?: unknown
  result_text?: unknown
  duration_s?: number
}

const asText = (v: unknown): string | undefined => (typeof v === 'string' ? v : v == null ? undefined : JSON.stringify(v))

/** The work block of a generation, if one is open. */
export const findWork = (items: readonly ChatItem[], id: string): WorkItem | undefined =>
  items.find((i): i is WorkItem => i.kind === 'work' && i.id === id)

function replaceWork(items: readonly ChatItem[], id: string, change: (w: WorkItem) => WorkItem): ChatItem[] {
  return items.map(i => (i.kind === 'work' && i.id === id ? change(i) : i))
}

/**
 * Apply a tool frame to the generation's work block, upserting the step by tool_id.
 * A replayed `start`/`progress` never re-opens a step that already completed.
 */
export function applyToolFrame(items: readonly ChatItem[], workId: string, type: string, payload: ToolPayload): ChatItem[] {
  const id = payload.tool_id ?? payload.tool_call_id
  if (!id) return [...items]
  const name = payload.name ?? payload.tool_name ?? 'tool'
  // A turn opened mid-way (resume of a running turn) never saw message.start, so create its block on the first tool event.
  const withBlock = findWork(items, workId) ? items : [...items, { kind: 'work' as const, id: workId, steps: [] }]
  return replaceWork(withBlock, workId, work => {
    const existing = work.steps.find(s => s.id === id)
    if (type !== 'tool.complete' && existing && !existing.running) return work
    const detail = asText(payload.result_text ?? payload.result)
    const next: WorkStep = {
      id,
      name: existing?.name ?? name,
      summary: payload.context || existing?.summary || name,
      running: type !== 'tool.complete',
      ...(type === 'tool.complete'
        ? { isError: payload.is_error === true, ...(detail ? { detail } : {}) }
        : existing?.detail ? { detail: existing.detail } : {})
    }
    const steps = existing ? work.steps.map(s => (s.id === id ? next : s)) : [...work.steps, next]
    const wasDone = existing !== undefined && !existing.running
    const durationS = type === 'tool.complete' && !wasDone && payload.duration_s ? (work.durationS ?? 0) + payload.duration_s : work.durationS
    return { ...work, steps, ...(durationS !== undefined ? { durationS } : {}) }
  })
}

/** Stop every running step and drop work blocks that never got a step. */
export function finishWork(items: readonly ChatItem[]): ChatItem[] {
  return items
    .map(i => (i.kind === 'work' ? { ...i, steps: i.steps.map(s => (s.running ? { ...s, running: false } : s)) } : i))
    .filter(i => !(i.kind === 'work' && i.steps.length === 0))
}
