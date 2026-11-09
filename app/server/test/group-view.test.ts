import { describe, expect, it } from 'vitest'

import { isActive, previewFrom, toGroupView } from '../src/groups/group-view.js'
import type { HermesDriverStatus, HermesRoom, HermesRoomEvent, HermesRoomState } from '../src/groups/types.js'

const room: HermesRoom = {
  room_id: 'r1',
  name: 'N',
  members: [{ member_id: 'a', profile: 'a', handle: 'a', display_name: 'Aa' }, { member_id: 'b', profile: 'b', handle: 'b' }],
  authority_epoch: 2,
  revision: 1,
  created_at: 10,
  updated_at: 20.5,
  latest_seq: 4
}
const status = (over: Partial<HermesDriverStatus> = {}): HermesDriverStatus => ({
  working: false, blocked: false, pending_actions: [], member_activity: [], max_rounds: 3, max_continues: 5, ...over
})
const withStatus = (s: HermesDriverStatus, ctx?: HermesRoomState['context']): HermesRoomState => ({ room, context: ctx, driver_status: s })
const ev = (kind: string, actorId: string, text: string, extra: Partial<HermesRoomEvent['actor']> = {}): HermesRoomEvent => ({
  room_id: 'r1', seq: 1, event_id: 'e', kind, actor: { kind: 'x', id: actorId, ...extra }, authority_epoch: 1, payload: { text }, created_at: 1
})

describe('toGroupView', () => {
  it('defaults without state and maps empty lead to null', () => {
    const v = toGroupView(room, undefined, null, 0)
    expect(v).toMatchObject({ routing: 'everyone', purpose: '', notes: '', leadMemberId: null, latestSeq: 4, updatedAt: 20500, maxContinues: 5, maxRounds: 3, working: false, epoch: 2 })
    expect(v.members[0].displayName).toBe('Aa')
    expect(v.members[1].displayName).toBeNull()
    const w = toGroupView(room, withStatus(status(), { purpose: 'p', notes: 'n', routing: 'lead', lead_member_id: '' }), null, 0)
    expect(w.leadMemberId).toBeNull()
    expect(w.routing).toBe('lead')
    expect(toGroupView(room, withStatus(status(), { purpose: '', notes: '', routing: 'lead', lead_member_id: 'a' }), null, 0).leadMemberId).toBe('a')
  })

  it('computes stalled at the 120 s boundary', () => {
    const s = withStatus(status({ member_activity: [{ member_id: 'a', status: 'running', started_at: 100, progress_at: null }] }))
    expect(toGroupView(room, s, null, 100_000 + 119_999).activity[0].stalled).toBe(false)
    expect(toGroupView(room, s, null, 100_000 + 120_001).activity[0].stalled).toBe(true)
    const q = withStatus(status({ member_activity: [{ member_id: 'a', status: 'queued', started_at: 1 }] }))
    expect(toGroupView(room, q, null, 9e9).activity[0].stalled).toBe(false)
  })

  it('is working when a member is stopping, and maps turn actions', () => {
    const s = withStatus(status({
      member_activity: [{ member_id: 'a', status: 'stopping' }],
      pending_actions: [
        { kind: 'retry', member_id: 'a', task_id: 't', execution_generation: 2 },
        { kind: 'approval', member_id: 'b', task_id: 't2', execution_generation: 1, session_id: 's', request_id: 'q', approval: {} }
      ]
    }))
    const v = toGroupView(room, s, null, 0)
    expect(v.working).toBe(true)
    expect(v.turnActions).toEqual([{ memberId: 'a', kind: 'retry', taskId: 't', executionGeneration: 2 }])
  })
})

describe('previewFrom', () => {
  it('picks the last user or member message', () => {
    expect(previewFrom([ev('message.member', 'a', 'old'), ev('room.activity', 'x', 'skip')])).toEqual({ speaker: { kind: 'member', memberId: 'a' }, text: 'old' })
    expect(previewFrom([ev('message.user', 'desktop', '\n\nhello\nmore')])).toEqual({ speaker: { kind: 'user' }, text: 'hello' })
    expect(previewFrom([ev('message.user', 'cron1', 'tick', { display_name: 'Cron' })])).toEqual({ speaker: { kind: 'other', label: 'Cron' }, text: 'tick' })
    expect(previewFrom([ev('message.user', 'cron1', 'tick')])?.speaker).toEqual({ kind: 'other', label: 'cron1' })
    expect(previewFrom([ev('room.context_set', 'x', '')])).toBeNull()
  })

  it('cuts an 81-char line to 80 with an ellipsis', () => {
    const text = previewFrom([ev('message.user', 'desktop', 'x'.repeat(81))])?.text ?? ''
    expect(text).toHaveLength(80)
    expect(text.endsWith('…')).toBe(true)
    expect(previewFrom([ev('message.user', 'desktop', 'x'.repeat(80))])?.text).toHaveLength(80)
  })
})

describe('isActive', () => {
  it('is true for working, activity or pending actions', () => {
    expect(isActive(undefined)).toBe(false)
    expect(isActive(withStatus(status()))).toBe(false)
    expect(isActive(withStatus(status({ working: true })))).toBe(true)
    expect(isActive(withStatus(status({ member_activity: [{ member_id: 'a', status: 'queued' }] })))).toBe(true)
    expect(isActive(withStatus(status({ pending_actions: [{ kind: 'discard', member_id: 'a', task_id: 't', execution_generation: 1 }] })))).toBe(true)
  })
})
