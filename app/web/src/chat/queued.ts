import type { ChatItem } from './types'

/** Mark the user message of a submission as queued behind the running turn. */
export function markQueued(items: readonly ChatItem[], submissionId: string): ChatItem[] {
  return items.map(i => (i.kind === 'user' && i.submissionId === submissionId ? { ...i, queued: true } : i))
}

/** Drop every queued mark: a new turn started, so nothing waits behind the old one. */
export function clearQueued(items: readonly ChatItem[]): readonly ChatItem[] {
  if (!items.some(i => i.kind === 'user' && i.queued)) return items
  return items.map((i): ChatItem => {
    if (i.kind !== 'user' || !i.queued) return i
    const { queued: _queued, ...rest } = i
    return rest
  })
}
