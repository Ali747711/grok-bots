import type { GroupEvent, HermesRoomEvent } from './types.js'

type Payload = Record<string, unknown>

const STRING_KEYS = [
  ['text', 'text'], ['thread_id', 'threadId'], ['member_id', 'memberId'], ['discussion_event_id', 'discussionEventId'],
  ['status', 'status'], ['reason_code', 'reasonCode'], ['error', 'error'], ['reason', 'reason'], ['name', 'name'],
  ['routing', 'routing'], ['lead_member_id', 'leadMemberId']
] as const
const BOOLEAN_KEYS = [['everyone', 'everyone'], ['fallback', 'fallback']] as const

/** Copy only the known payload keys (right type only); anything else a payload carries never reaches the browser. */
export function toGroupEvent(e: HermesRoomEvent): GroupEvent {
  const p: Payload = e.payload ?? {}
  const out: GroupEvent = {
    seq: e.seq,
    eventId: e.event_id,
    kind: e.kind,
    createdAt: Math.round(e.created_at * 1000),
    actor: { kind: e.actor.kind, id: e.actor.id, profile: e.actor.profile ?? null, displayName: e.actor.display_name ?? null }
  }
  const extra: Partial<Record<keyof GroupEvent, unknown>> = {}
  for (const [wire, key] of STRING_KEYS) if (typeof p[wire] === 'string') extra[key] = p[wire]
  for (const [wire, key] of BOOLEAN_KEYS) if (typeof p[wire] === 'boolean') extra[key] = p[wire]
  if (typeof p.round_index === 'number') extra.roundIndex = p.round_index
  if (Array.isArray(p.member_ids) && p.member_ids.every(v => typeof v === 'string')) extra.memberIds = p.member_ids
  return Object.assign(out, extra)
}
