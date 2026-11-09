import { describe, expect, it } from 'vitest'

import { appendEvents, currentTopic, hashEventId, toItems } from '@/features/groups/room-reducer'
import type { RoomLog } from '@/features/groups/room-reducer'
import type { GroupEvent, GroupView } from '@/state/types'

const view: GroupView = {
  id: 'r1', name: 'Team', routing: 'auto', leadMemberId: 'e2e1', purpose: '', notes: '', latestSeq: 0, epoch: 1, updatedAt: 0,
  working: false, activity: [], turnActions: [], maxContinues: 5, maxRounds: 3, preview: null,
  members: ['reese', 'e2e1'].map(h => ({ memberId: h, profile: h, handle: h, displayName: null }))
}
const titleOf = (id: string): string => (id === 'e2e1' ? 'E2E One' : 'Reese')
let n = 0
const ev = (kind: string, extra: Partial<GroupEvent> = {}): GroupEvent => {
  n += 1
  return { seq: n, eventId: `e${n}`, kind, createdAt: n, actor: { kind: 'user', id: 'desktop', profile: null, displayName: null }, ...extra }
}
const log = (events: GroupEvent[]): RoomLog => ({ epoch: 1, cursor: events.at(-1)?.seq ?? 0, events, cut: false })
const items = (events: GroupEvent[], optimistic = [] as Parameters<typeof toItems>[3]) => toItems(log(events), view, titleOf, optimistic)

describe('toItems', () => {
  it('attributes member messages and marks new topics', () => {
    const out = items([
      ev('message.user', { text: 'a', threadId: 't1' }),
      ev('message.member', { text: 'r', threadId: 't1', memberId: 'reese', actor: { kind: 'member', id: 'reese', profile: 'reese', displayName: null } }),
      ev('message.user', { text: 'b', threadId: 't2' })
    ])
    expect(out.map(i => i.kind)).toEqual(['user', 'member', 'user'])
    expect(out[0]).toMatchObject({ author: 'you', newTopic: false })
    expect(out[1]).toMatchObject({ memberId: 'reese', text: 'r' })
    expect(out[2]).toMatchObject({ newTopic: true })
  })

  it('shows Keep going only on the latest bounded notice that can continue', () => {
    const bounded = ev('room.activity', { status: 'bounded', reasonCode: 'max_rounds', discussionEventId: 'd1' })
    expect(items([bounded]).at(-1)).toMatchObject({ kind: 'notice', text: 'Paused after 3 rounds', action: { kind: 'continue', discussionEventId: 'd1' } })
    const five = Array.from({ length: 5 }, () => ev('room.continued', { discussionEventId: 'd1' }))
    expect(items([bounded, ...five]).find(i => i.kind === 'notice' && i.text.startsWith('Paused'))).not.toHaveProperty('action')
    const stopped = items([bounded, ev('room.stop_requested')]).find(i => i.kind === 'notice' && i.text.startsWith('Paused'))
    expect(stopped).not.toHaveProperty('action')
    const newer = items([bounded, ev('message.user', { text: 'x', threadId: 't' })]).find(i => i.kind === 'notice')
    expect(newer).not.toHaveProperty('action')
    const second = ev('room.activity', { status: 'bounded', reasonCode: 'max_messages', discussionEventId: 'd1' })
    const both = items([bounded, second]).filter(i => i.kind === 'notice')
    expect(both[0]).not.toHaveProperty('action')
    expect(both[1]).toMatchObject({ text: 'Paused after 10 replies', action: { kind: 'continue' } })
  })

  it('replaces the optimistic item when the log row arrives', async () => {
    const hash = await hashEventId('abc')
    expect(hash).toMatch(/^user:[0-9a-f]{64}$/)
    const opt = [{ eventId: 'abc', eventIdHash: hash, text: 'hi', threadId: 'abc', status: 'sending' as const }]
    const pending = items([], opt)
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({ kind: 'user', seq: null, status: 'sending', author: 'you', newTopic: false })
    const landed = items([ev('message.user', { text: 'hi', threadId: 'abc', eventId: hash })], opt)
    expect(landed).toHaveLength(1)
    expect(landed[0]).toMatchObject({ seq: expect.any(Number) })
  })

  it('renders routed, assignment, failed, unavailable, renamed, context and stop notices with the spec copy', () => {
    const text = (events: GroupEvent[]): string[] => items(events).flatMap(i => (i.kind === 'notice' ? [i.text] : []))
    expect(text([ev('room.routed', { memberIds: ['reese'] })])).toEqual(['Auto picked @reese'])
    expect(text([ev('room.routed', { memberIds: ['reese', 'e2e1'] })])).toEqual(['Auto picked @reese and @e2e1'])
    expect(text([ev('room.routed', { fallback: true })])).toEqual(["Auto couldn't decide, so everyone replies"])
    expect(text([ev('room.assignment', { memberIds: ['reese', 'e2e1'] })])).toEqual(['E2E One assigned @reese, @e2e1'])
    expect(text([ev('turn.failed', { memberId: 'reese', error: 'boom', reasonCode: 'x' })])).toEqual(["Reese couldn't reply: boom"])
    expect(text([ev('turn.failed', { memberId: 'reese', reasonCode: 'timeout' })])).toEqual(["Reese couldn't reply: timeout"])
    expect(text([ev('member.unavailable', { error: 'Reese is gone' })])).toEqual(['Reese is gone'])
    expect(text([ev('room.stop_requested')])).toEqual(['Stopped'])
    expect(text([ev('room.renamed', { name: 'New' })])).toEqual(['Group renamed to “New”'])
    expect(text([ev('room.context_set', { routing: 'lead' })])).toEqual(['Replies set to Lead'])
    expect(text([ev('room.context_set', { routing: 'everyone' })])).toEqual(['Replies set to Everyone'])
  })

  it('names the assigning lead from the event, not the current room lead', () => {
    const text = (e: GroupEvent, v: GroupView = view): string[] => toItems(log([e]), v, titleOf, []).flatMap(i => (i.kind === 'notice' ? [i.text] : []))
    const gateway = { kind: 'gateway', id: 'gw-1', profile: null, displayName: null }
    const auto = { ...view, leadMemberId: null }
    expect(text(ev('room.assignment', { memberIds: ['reese'], leadMemberId: 'e2e1', actor: gateway }), auto)).toEqual(['E2E One assigned @reese'])
    expect(text(ev('room.assignment', { memberIds: ['reese'], actor: gateway }), auto)).toEqual(['Lead assigned @reese'])
  })

  it('hides settled, cancelled, deferred, continued, disbanded and unknown events', () => {
    expect(items([
      ev('room.activity', { status: 'settled' }), ev('turn.settled'), ev('turn.cancelled'), ev('turn.deferred'),
      ev('room.continued'), ev('room.disbanded'), ev('weird.thing')
    ])).toEqual([])
  })
})

describe('appendEvents', () => {
  it('is idempotent by seq and replaces history on an epoch change', () => {
    const a = ev('message.user', { text: 'a', threadId: 't' })
    const b = ev('message.user', { text: 'b', threadId: 't' })
    const l1 = appendEvents(log([a]), { events: [a, b], epoch: 1, cursor: b.seq })
    const l2 = appendEvents(l1, { events: [b], epoch: 1, cursor: b.seq })
    expect(l2.events.map(e => e.seq)).toEqual([a.seq, b.seq])
    expect(l2.cursor).toBe(b.seq)
    const c = ev('message.user', { text: 'c', threadId: 't' })
    const l3 = appendEvents(l2, { events: [c], epoch: 2, cursor: c.seq })
    expect(l3).toMatchObject({ epoch: 2, cursor: c.seq })
    expect(l3.events).toEqual([c])
  })
})

describe('currentTopic', () => {
  it('is the thread of the latest user message', () => {
    expect(currentTopic(log([]))).toBeNull()
    expect(currentTopic(log([ev('message.user', { threadId: 't1' }), ev('message.member', { threadId: 'x' }), ev('message.user', { threadId: 't2' })]))).toBe('t2')
  })
})
