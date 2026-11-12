import type { ChatItem, WorkStep } from '@/chat/types'

export interface RecentAction {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly failed: boolean
  /** Epoch ms, or null when neither the client nor the history row gave the step a time. */
  readonly at: number | null
}

const DEFAULT_LIMIT = 50

type Work = Extract<ChatItem, { kind: 'work' }>
const isWork = (item: ChatItem): item is Work => item.kind === 'work'

/** The chat's tool steps, newest first, at most `limit`. The id joins the turn and the step, since a step id is only unique in its turn. */
export function recentActions(items: readonly ChatItem[], limit = DEFAULT_LIMIT): readonly RecentAction[] {
  return items
    .filter(isWork)
    .flatMap(work => work.steps.map(step => ({ id: `${work.id}:${step.id}`, name: step.name, summary: step.summary, failed: step.isError === true, at: step.at ?? null })))
    .reverse()
    .slice(0, limit)
}

/** The step running right now: the newest running step of the last turn's work, or null. */
export function nowStep(items: readonly ChatItem[]): WorkStep | null {
  return items.findLast(isWork)?.steps.findLast(step => step.running) ?? null
}

const two = (n: number): string => String(n).padStart(2, '0')

/** Local time as 'HH:MM' on a 24-hour clock. */
export function formatClock(ms: number): string {
  const date = new Date(ms)
  return `${two(date.getHours())}:${two(date.getMinutes())}`
}
