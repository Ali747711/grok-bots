import type { GroupEvent, GroupView } from '@/state/types'

export type GroupItem =
  | {
      kind: 'user'
      key: string
      seq: number | null
      eventId: string
      text: string
      author: 'you' | string
      threadId: string
      newTopic: boolean
      status?: 'sending' | 'unknown' | 'refused'
      error?: string
    }
  | { kind: 'member'; key: string; seq: number; memberId: string; text: string; threadId: string }
  | { kind: 'notice'; key: string; seq: number; text: string; tone: 'info' | 'warn'; action?: { kind: 'continue'; discussionEventId: string } }

/** Hermes's planner keeps only the last 24 user+member events per thread; past that, preparing a turn fails. */
export const HERMES_TOPIC_LIMIT = 24
/** One user message can draw up to 10 visible replies. */
export const MAX_REPLIES_PER_MESSAGE = 10
/** A topic this long starts fresh: one more message plus its replies still fits in Hermes's 24. */
export const TOPIC_ROTATE_AT = HERMES_TOPIC_LIMIT - MAX_REPLIES_PER_MESSAGE

export interface RoomLog {
  epoch: number
  cursor: number
  events: readonly GroupEvent[]
  /** True when older history was left out of the loaded window. */
  cut: boolean
}

export interface OptimisticSend {
  eventId: string
  eventIdHash: string
  text: string
  threadId: string
  status: 'sending' | 'unknown' | 'refused'
  error?: string
}

type Notice = Extract<GroupItem, { kind: 'notice' }>
type Titles = (memberId: string) => string

/** Merge a page into the log: idempotent by seq; a new epoch replaces the history. */
export function appendEvents(log: RoomLog, page: { events: readonly GroupEvent[]; epoch: number; cursor: number }): RoomLog {
  if (page.epoch !== log.epoch) return { epoch: page.epoch, cursor: page.cursor, events: [...page.events].sort((a, b) => a.seq - b.seq), cut: false }
  const bySeq = new Map(log.events.map(e => [e.seq, e]))
  for (const e of page.events) if (!bySeq.has(e.seq)) bySeq.set(e.seq, e)
  const events = [...bySeq.values()].sort((a, b) => a.seq - b.seq)
  return { ...log, events, cursor: Math.max(log.cursor, page.cursor) }
}

const threadOfEvent = (e: GroupEvent): string => e.threadId ?? e.eventId
const isMessage = (e: GroupEvent): boolean => e.kind === 'message.user' || e.kind === 'message.member'

/** Messages (user + member) in one thread of the loaded log. */
export function topicMessageCount(log: RoomLog, threadId: string): number {
  return log.events.filter(e => isMessage(e) && threadOfEvent(e) === threadId).length
}

/**
 * False when the loaded log may be missing the start of the thread (it was cut), so its length is unknown
 * and the safe move is a new topic.
 */
export function topicStartKnown(log: RoomLog, threadId: string): boolean {
  const first = log.events.find(e => isMessage(e) && threadOfEvent(e) === threadId)
  if (!first) return true
  if (first.kind !== 'message.user') return false
  return !(log.cut && first.seq === log.events[0]?.seq)
}

/** The topic is the thread of the latest user message, so Crew stores nothing of its own. */
export function currentTopic(log: RoomLog): string | null {
  for (let i = log.events.length - 1; i >= 0; i--) {
    const e = log.events[i]!
    if (e.kind === 'message.user') return e.threadId ?? e.eventId
  }
  return null
}

/** Hermes stores a browser event id as `user:` + sha256 hex of it. */
export async function hashEventId(eventId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(eventId))
  return `user:${[...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')}`
}

const handlesOf = (view: GroupView, ids: readonly string[] | undefined): string[] =>
  (ids ?? []).map(id => `@${view.members.find(m => m.memberId === id)?.handle ?? id}`)

const joinAnd = (tags: readonly string[]): string => (tags.length < 2 ? (tags[0] ?? '') : `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]!}`)

const ROUTING_LABEL: Readonly<Record<string, string>> = { auto: 'Auto', everyone: 'Everyone', lead: 'Lead' }

function noticeText(e: GroupEvent, view: GroupView, titleOf: Titles): { text: string; tone: Notice['tone'] } | null {
  switch (e.kind) {
    case 'room.routed': {
      const picked = handlesOf(view, e.memberIds)
      if (e.fallback || e.everyone || picked.length === 0) return { text: "Auto couldn't decide, so everyone replies", tone: 'info' }
      return { text: `Auto picked ${joinAnd(picked)}`, tone: 'info' }
    }
    case 'room.assignment': {
      // The event names its own lead; the room's current lead may differ or be cleared. Never use the gateway actor id.
      const lead = e.leadMemberId ?? view.leadMemberId
      return { text: `${lead ? titleOf(lead) : 'Lead'} assigned ${handlesOf(view, e.memberIds).join(', ')}`, tone: 'info' }
    }
    case 'turn.failed':
      return { text: `${titleOf(e.memberId ?? e.actor.id)} couldn't reply: ${e.error ?? e.reasonCode ?? 'unknown reason'}`, tone: 'warn' }
    case 'member.unavailable':
      return { text: e.error ?? `${titleOf(e.memberId ?? e.actor.id)} is unavailable`, tone: 'warn' }
    case 'room.stop_requested':
      return { text: 'Stopped', tone: 'info' }
    case 'room.renamed':
      return { text: `Group renamed to “${e.name ?? ''}”`, tone: 'info' }
    case 'room.context_set':
      return { text: `Replies set to ${ROUTING_LABEL[e.routing ?? ''] ?? e.routing ?? ''}`.trim(), tone: 'info' }
    case 'room.activity': {
      if (e.status !== 'bounded') return null
      return { text: e.reasonCode === 'max_messages' ? 'Paused after 10 replies' : `Paused after ${view.maxRounds} rounds`, tone: 'info' }
    }
    default:
      return null
  }
}

/** The latest bounded event gets Keep going while its discussion has continues left and nothing newer ended it. */
function continueTarget(log: RoomLog, view: GroupView): { event: GroupEvent; tooLong: boolean } | null {
  const events = log.events
  let latest = -1
  for (let i = 0; i < events.length; i++) if (events[i]!.kind === 'room.activity' && events[i]!.status === 'bounded') latest = i
  if (latest < 0) return null
  const bounded = events[latest]!
  if (!bounded.discussionEventId) return null
  const later = events.slice(latest + 1)
  if (later.some(e => e.kind === 'room.stop_requested' || e.kind === 'message.user')) return null
  const used = events.filter(e => e.kind === 'room.continued' && e.discussionEventId === bounded.discussionEventId).length
  if (used >= view.maxContinues) return null
  const thread = bounded.threadId ?? events.find(e => e.eventId === bounded.discussionEventId)?.threadId ?? bounded.discussionEventId
  return { event: bounded, tooLong: topicMessageCount(log, thread) > TOPIC_ROTATE_AT }
}

export function toItems(log: RoomLog, view: GroupView, titleOf: Titles, optimistic: readonly OptimisticSend[]): GroupItem[] {
  const items: GroupItem[] = []
  const resumable = continueTarget(log, view)
  const landed = new Set(log.events.filter(e => e.kind === 'message.user').map(e => e.eventId))
  let lastThread: string | null = null
  for (const e of log.events) {
    if (e.kind === 'message.user') {
      const threadId = e.threadId ?? e.eventId
      const author = e.actor.id === 'desktop' ? 'you' : (e.actor.displayName ?? e.actor.id)
      items.push({ kind: 'user', key: `e${e.seq}`, seq: e.seq, eventId: e.eventId, text: e.text ?? '', author, threadId, newTopic: lastThread !== null && threadId !== lastThread })
      lastThread = threadId
    } else if (e.kind === 'message.member') {
      items.push({ kind: 'member', key: `e${e.seq}`, seq: e.seq, memberId: e.memberId ?? e.actor.id, text: e.text ?? '', threadId: e.threadId ?? e.eventId })
    } else {
      const notice = noticeText(e, view, titleOf)
      if (!notice) continue
      const mine = resumable?.event === e
      const action = mine && !resumable.tooLong && e.discussionEventId ? { kind: 'continue' as const, discussionEventId: e.discussionEventId } : undefined
      // Hermes cannot plan a thread this long, so Keep going would fail; point at a new topic instead.
      const text = mine && resumable.tooLong ? `${notice.text}. Start a new topic to continue.` : notice.text
      items.push({ kind: 'notice', key: `e${e.seq}`, seq: e.seq, ...notice, text, ...(action ? { action } : {}) })
    }
  }
  for (const o of optimistic) {
    if (landed.has(o.eventIdHash)) continue
    items.push({
      kind: 'user', key: `o${o.eventId}`, seq: null, eventId: o.eventId, text: o.text, author: 'you', threadId: o.threadId,
      newTopic: lastThread !== null && o.threadId !== lastThread, status: o.status, ...(o.error ? { error: o.error } : {})
    })
    lastThread = o.threadId
  }
  return items
}
