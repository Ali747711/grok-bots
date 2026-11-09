import { describe, expect, it } from 'vitest'

import { HermesRpcError } from '../src/hermes/errors.js'
import { createGroupRpc, groupErrorReason } from '../src/groups/group-rpc.js'

const setup = (reply: (method: string, params: Record<string, unknown>) => unknown = () => ({})) => {
  const calls: [string, Record<string, unknown>][] = []
  const rpc = (async (method: string, params: Record<string, unknown>) => {
    calls.push([method, params])
    return reply(method, params)
  }) as never
  return { calls, g: createGroupRpc(rpc, () => 'id1') }
}

describe('group rpc', () => {
  it('pins profile default and sends exact keys', async () => {
    const { g, calls } = setup()
    await g.state('r1')
    await g.log('r1', 5, 100)
    expect(calls).toEqual([
      ['groups.state', { profile: 'default', room_id: 'r1' }],
      ['groups.log', { profile: 'default', room_id: 'r1', since_seq: 5, limit: 100 }]
    ])
  })

  it('setContext always sends purpose and notes', async () => {
    const { g, calls } = setup(() => ({ context: { routing: 'auto' } }))
    await g.setContext('r1', { routing: 'auto', leadMemberId: '', purpose: '', notes: '' })
    expect(calls).toEqual([
      ['groups.context', { profile: 'default', room_id: 'r1', event_id: 'crew-id1', purpose: '', notes: '', routing: 'auto', lead_member_id: '' }]
    ])
  })

  it('send uses the eventId as event_id and the given thread', async () => {
    const { g, calls } = setup(() => ({ event: { seq: 9 } }))
    expect(await g.send('r1', { eventId: 'e1', text: 'hi', threadId: 't1' })).toEqual({ seq: 9 })
    expect(calls).toEqual([['groups.send', { profile: 'default', room_id: 'r1', event_id: 'e1', payload: { text: 'hi', thread_id: 't1' } }]])
  })

  it('list follows next_offset across pages', async () => {
    const { g, calls } = setup((_m, p) =>
      p.offset === undefined ? { rooms: [{ room_id: 'a' }], next_offset: 1 } : { rooms: [{ room_id: 'b' }], next_offset: null }
    )
    expect((await g.list()).map(r => r.room_id)).toEqual(['a', 'b'])
    expect(calls).toEqual([
      ['groups.list', { profile: 'default', limit: 100 }],
      ['groups.list', { profile: 'default', limit: 100, offset: 1 }]
    ])
  })

  it('approve sends only once|deny', async () => {
    const { g, calls } = setup()
    await g.approve('r1', { memberId: 'm', taskId: 't', executionGeneration: 2, choice: 'once', requestId: 'q' })
    expect(calls).toEqual([
      ['groups.approve', { profile: 'default', room_id: 'r1', member_id: 'm', task_id: 't', execution_generation: 2, choice: 'once', request_id: 'q' }]
    ])
  })

  it('sends exact keys for create, rename, stop, continue, retry, discard and disband', async () => {
    const { g, calls } = setup((m) => (m === 'groups.stop' ? { cancelled: 1 } : { room: { room_id: 'r1' } }))
    await g.create({ roomId: 'r1', name: 'N', members: [] })
    await g.rename('r1', 'M')
    await g.stop('r1', 'c1')
    await g.continueDiscussion('r1', 'd1')
    const t = { memberId: 'm', taskId: 't', executionGeneration: 1 }
    await g.retry('r1', t)
    await g.discard('r1', t)
    await g.disband('r1', 'c2')
    const ref = { room_id: 'r1', member_id: 'm', task_id: 't', execution_generation: 1 }
    expect(calls).toEqual([
      ['groups.create', { profile: 'default', room_id: 'r1', name: 'N', members: [] }],
      ['groups.rename', { profile: 'default', room_id: 'r1', event_id: 'crew-id1', name: 'M' }],
      ['groups.stop', { profile: 'default', room_id: 'r1', cancel_id: 'c1' }],
      ['groups.continue', { profile: 'default', room_id: 'r1', discussion_event_id: 'd1' }],
      ['groups.retry', { profile: 'default', ...ref }],
      ['groups.discard', { profile: 'default', ...ref }],
      ['groups.disband', { profile: 'default', room_id: 'r1', cancel_id: 'c2' }]
    ])
  })

  it('groupErrorReason reads reason/detail/admitted from HermesRpcError.data', () => {
    const e = new HermesRpcError(4001, 'x', { reason: 'runtime_coordination_required', detail: 'd', admitted: false })
    expect(groupErrorReason(e)).toEqual({ reason: 'runtime_coordination_required', detail: 'd', admitted: false })
    expect(groupErrorReason(new HermesRpcError(4001, 'x', { reason: 'r' }))).toEqual({ reason: 'r' })
    expect(groupErrorReason(new HermesRpcError(4001, 'x'))).toBeNull()
    expect(groupErrorReason(new Error('x'))).toBeNull()
  })
})
