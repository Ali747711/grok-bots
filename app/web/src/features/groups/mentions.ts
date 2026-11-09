import type { GroupMemberView, Routing } from '@/state/types'

/** Port of Hermes's `_MENTION_RE` (hosted_room_discussion.py): a trailing dot or colon is part of the token. */
export const MENTION_RE = /@([A-Za-z0-9][A-Za-z0-9._:-]*)/g

export interface MentionSpan {
  readonly start: number
  readonly end: number
  readonly memberIds: string[]
}

const EVERYONE = new Set(['all', 'everyone'])

/** Only tokens that resolve to a member handle (casefold) or to everyone are returned. */
export function findMentions(text: string, members: readonly GroupMemberView[]): MentionSpan[] {
  const byHandle = new Map(members.map(m => [m.handle.toLowerCase(), m.memberId]))
  const spans: MentionSpan[] = []
  for (const match of text.matchAll(MENTION_RE)) {
    const handle = (match[1] ?? '').toLowerCase()
    const start = match.index ?? 0
    const end = start + match[0].length
    if (EVERYONE.has(handle)) spans.push({ start, end, memberIds: members.map(m => m.memberId) })
    else if (byHandle.has(handle)) spans.push({ start, end, memberIds: [byHandle.get(handle)!] })
  }
  return spans
}

/** Addressed members in roster order, or null when the text addresses nobody. */
export function recipients(text: string, members: readonly GroupMemberView[]): string[] | null {
  const hit = new Set(findMentions(text, members).flatMap(s => s.memberIds))
  if (hit.size === 0) return null
  return members.filter(m => hit.has(m.memberId)).map(m => m.memberId)
}

export interface WhoWillAnswerInput {
  readonly text: string
  readonly members: readonly GroupMemberView[]
  readonly routing: Routing
  readonly leadMemberId: string | null
  readonly firstInTopic: boolean
  readonly titleOf: (memberId: string) => string
}

function joinHandles(handles: readonly string[]): string {
  const tags = handles.map(h => `@${h}`)
  if (tags.length === 1) return tags[0]!
  return `${tags.slice(0, -1).join(', ')} and ${tags[tags.length - 1]!}`
}

/** The line under the composer: who Hermes will wake for this message (spec goal 4). */
export function whoWillAnswer(input: WhoWillAnswerInput): string {
  const { text, members, routing, leadMemberId, firstInTopic, titleOf } = input
  const everyone = `Everyone (${members.length} bots)`
  const named = recipients(text, members)
  if (named) {
    if (text.match(MENTION_RE)?.some(t => EVERYONE.has(t.slice(1).toLowerCase()))) return `${everyone} will reply`
    const handles = members.filter(m => named.includes(m.memberId)).map(m => m.handle)
    return `${joinHandles(handles)} will reply`
  }
  if (!firstInTopic) return `${everyone} will reply · @mention to ask one bot`
  if (routing === 'auto') return 'Auto will pick who replies'
  if (routing === 'lead') return `${leadMemberId ? titleOf(leadMemberId) : 'The lead'} will pick who replies`
  return `${everyone} will reply`
}

/** The `@token` being typed at the caret, for the popover; `@` must start the text or follow whitespace. */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret)
  const match = /(^|\s)@([A-Za-z0-9._:-]*)$/.exec(before)
  if (!match) return null
  const query = match[2] ?? ''
  return { start: caret - query.length - 1, query }
}
