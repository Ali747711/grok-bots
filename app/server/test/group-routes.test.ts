import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import { toGroupEvent } from '../src/groups/group-events.js'
import { HermesRpcError, HermesUnavailableError } from '../src/hermes/errors.js'
import type { GroupRpc } from '../src/groups/group-rpc.js'
import type { GroupView, HermesRoomEvent } from '../src/groups/types.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const cookie = `crew_session=${session}; ${CSRF_COOKIE}=tok`
const headers = { Host: HOST, Origin: ORIGIN, Cookie: cookie, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

const view = (over: Partial<GroupView> = {}): GroupView => ({
  id: 'r1', name: 'N', members: [{ memberId: 'a', profile: 'a', handle: 'a', displayName: null }, { memberId: 'b', profile: 'b', handle: 'b', displayName: null }],
  routing: 'everyone', leadMemberId: null, purpose: '', notes: '', latestSeq: 0, epoch: 1, updatedAt: 1, working: false, activity: [],
  turnActions: [{ memberId: 'a', kind: 'retry', taskId: 't1', executionGeneration: 2 }], maxContinues: 5, maxRounds: 3, preview: null, ...over
})
const rpcError = (message: string, data?: unknown) => new HermesRpcError(4001, message, data)

let rpc: Record<keyof GroupRpc, ReturnType<typeof vi.fn>>
let available: boolean
let rooms: GroupView[]
let sleeps: number[]
let app: ReturnType<typeof createApp>
let refreshRoom: ReturnType<typeof vi.fn>
let refreshList: ReturnType<typeof vi.fn>
let ids: number

const send = (method: string, path: string, payload?: unknown, h: Record<string, string> = headers) =>
  app.request(path, { method, headers: h, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })

beforeEach(() => {
  ids = 0
  available = true
  rooms = [view()]
  sleeps = []
  refreshRoom = vi.fn(async () => undefined)
  refreshList = vi.fn(async () => undefined)
  rpc = {
    capabilities: vi.fn(), list: vi.fn(), state: vi.fn(),
    log: vi.fn(async () => ({ events: [], cursor: 3, latest_seq: 7, has_more: true, authority: { epoch: 4 } })),
    create: vi.fn(async () => ({ room_id: 'x' })),
    setContext: vi.fn(async (_id: string, ctx: Record<string, unknown>) => ({ purpose: ctx.purpose, notes: ctx.notes, routing: ctx.routing, lead_member_id: ctx.leadMemberId })),
    rename: vi.fn(async () => ({ name: 'New' })),
    send: vi.fn(async () => ({ seq: 9 })),
    stop: vi.fn(async () => ({ cancelled: 2 })),
    continueDiscussion: vi.fn(async () => undefined), approve: vi.fn(), retry: vi.fn(async () => undefined),
    discard: vi.fn(async () => undefined), disband: vi.fn(async () => undefined)
  } as never
  app = createApp({
    ...base,
    groups: {
      rpc: rpc as unknown as GroupRpc,
      groups: { state: () => ({ available, seatable: ['default', 'a', 'b'], rooms }), seatable: () => new Set(['default', 'a', 'b']), refreshRoom, refreshList },
      roster: () => [{ name: 'default', title: 'Hermes', displayName: null }, { name: 'a', title: 'Alpha', displayName: 'Al' }, { name: 'b', title: 'Beta', displayName: null }, { name: 'c', title: 'Gamma', displayName: null }],
      newId: () => `id${++ids}`,
      sleep: async ms => { sleeps.push(ms) }
    }
  })
})

describe('POST /crew/groups', () => {
  it('creates a group with built rows and switches on Auto', async () => {
    const res = await send('POST', '/crew/groups', { name: ' Team ', members: ['a', 'b'] })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ roomId: 'id1', routing: 'auto' })
    expect(rpc.create).toHaveBeenCalledWith({
      roomId: 'id1', name: 'Team',
      members: [
        { member_id: 'a', profile: 'a', handle: 'a', display_name: 'Al', target: { kind: 'local', profile: 'a' } },
        { member_id: 'b', profile: 'b', handle: 'b', target: { kind: 'local', profile: 'b' } }
      ]
    })
    expect(rpc.setContext).toHaveBeenCalledWith('id1', { routing: 'auto', leadMemberId: '', purpose: '', notes: '' })
    expect(refreshList).toHaveBeenCalled()
  })

  it('refreshes the list after the routing is set and before answering', async () => {
    const order: string[] = []
    rpc.setContext.mockImplementationOnce(async (_id: string, ctx: Record<string, unknown>) => { order.push('context'); return { routing: ctx.routing, lead_member_id: '', purpose: '', notes: '' } })
    let release: () => void = () => undefined
    refreshList.mockImplementation(() => { order.push('refresh'); return new Promise<void>(r => { release = r }) })
    let answered = false
    const pending = send('POST', '/crew/groups', { members: ['a', 'b'] }).then(r => { answered = true; return r })
    await new Promise(r => setTimeout(r, 20))
    expect(order).toEqual(['context', 'refresh'])
    expect(answered).toBe(false)
    release()
    expect((await pending).status).toBe(201)
  })

  it('still answers 201 when the list refresh fails', async () => {
    refreshList.mockRejectedValue(new Error('down'))
    const res = await send('POST', '/crew/groups', { members: ['a', 'b'] })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ roomId: 'id1', routing: 'auto' })
  })

  it('still answers 201 with a warning when the context write fails', async () => {
    rpc.setContext.mockRejectedValueOnce(rpcError('nope'))
    const res = await send('POST', '/crew/groups', { members: ['a', 'b'] })
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ roomId: 'id1', routing: 'everyone', warning: 'routing_not_set' })
  })

  it('refuses a member outside the roster or not seatable', async () => {
    let res = await send('POST', '/crew/groups', { members: ['a', 'zz'] })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_members', reason: 'not_in_roster', profile: 'zz' })
    res = await send('POST', '/crew/groups', { members: ['a', 'c'] })
    expect(await res.json()).toEqual({ error: 'bad_members', reason: 'not_seatable', profile: 'c' })
    res = await send('POST', '/crew/groups', { members: ['a'] })
    expect(res.status).toBe(400)
    expect(rpc.create).not.toHaveBeenCalled()
  })

  it('defaults the name to the members titles', async () => {
    await send('POST', '/crew/groups', { members: ['default', 'b'] })
    expect(rpc.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Hermes, Beta' }))
  })

  it('rejects unknown keys and bad names, and reports unavailable groups', async () => {
    expect((await send('POST', '/crew/groups', { members: ['a', 'b'], extra: 1 })).status).toBe(400)
    expect((await send('POST', '/crew/groups', { members: ['a', 'b'], name: 'x'.repeat(65) })).status).toBe(400)
    available = false
    const res = await send('POST', '/crew/groups', { members: ['a', 'b'] })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'groups_unavailable' })
  })

  it('maps a Hermes refusal to 502 with its detail', async () => {
    rpc.create.mockRejectedValueOnce(rpcError('bad', { reason: 'x', detail: 'too many rooms' }))
    const res = await send('POST', '/crew/groups', { members: ['a', 'b'] })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'hermes_refused', detail: 'too many rooms' })
  })
})

describe('GET events', () => {
  it('maps events to GroupEvent and copies only known keys', async () => {
    const ev: HermesRoomEvent = {
      room_id: 'r1', seq: 3, event_id: 'e3', kind: 'message.user', actor: { kind: 'user', id: 'desktop' }, authority_epoch: 1, created_at: 12.5,
      payload: { text: 'hi', thread_id: 't', secretish: 'nope', member_ids: ['a'], round_index: 2, everyone: true, status: 5 }
    }
    expect(toGroupEvent(ev)).toEqual({
      seq: 3, eventId: 'e3', kind: 'message.user', createdAt: 12500, actor: { kind: 'user', id: 'desktop', profile: null, displayName: null },
      text: 'hi', threadId: 't', memberIds: ['a'], roundIndex: 2, everyone: true
    })
    rpc.log.mockResolvedValueOnce({ events: [ev], cursor: 3, latest_seq: 7, has_more: true, authority: { epoch: 4 } })
    const res = await send('GET', '/crew/groups/r1/events?since=2&limit=50')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { events: unknown[] }
    expect(body).toMatchObject({ cursor: 3, latestSeq: 7, hasMore: true, epoch: 4 })
    expect(JSON.stringify(body)).not.toContain('secretish')
    expect(rpc.log).toHaveBeenCalledWith('r1', 2, 50)
  })

  it('defaults and validates since and limit', async () => {
    await send('GET', '/crew/groups/r1/events')
    expect(rpc.log).toHaveBeenCalledWith('r1', 0, 100)
    expect((await send('GET', '/crew/groups/r1/events?limit=501')).status).toBe(400)
    expect((await send('GET', '/crew/groups/r1/events?since=-1')).status).toBe(400)
  })
})

describe('POST messages', () => {
  it('sends with the given thread or a new thread', async () => {
    let res = await send('POST', '/crew/groups/r1/messages', { eventId: 'e1', text: 'hi', threadId: 't1' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ accepted: true, seq: 9 })
    expect(rpc.send).toHaveBeenCalledWith('r1', { eventId: 'e1', text: 'hi', threadId: 't1' })
    await send('POST', '/crew/groups/r1/messages', { eventId: 'e2', text: 'yo' })
    expect(rpc.send).toHaveBeenLastCalledWith('r1', { eventId: 'e2', text: 'yo', threadId: 'e2' })
    expect(refreshRoom).toHaveBeenCalledWith('r1')
    res = await send('POST', '/crew/groups/r1/messages', { eventId: 'e3', text: 'é'.repeat(32_769) })
    expect(res.status).toBe(400)
  })

  it('reports admitted false as 409 and transport errors as unknown', async () => {
    rpc.send.mockRejectedValueOnce(rpcError('no driver', { reason: 'runtime_coordination_required', admitted: false }))
    let res = await send('POST', '/crew/groups/r1/messages', { eventId: 'e1', text: 'hi' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ admitted: false, reason: 'runtime_coordination_required' })
    rpc.send.mockRejectedValueOnce(new Error('timeout'))
    res = await send('POST', '/crew/groups/r1/messages', { eventId: 'e1', text: 'hi' })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ admitted: 'unknown' })
  })

  it('refuses ids that break the Hermes identifier rule', async () => {
    for (const eventId of [' x', '', '-a', 'a'.repeat(129)]) {
      expect((await send('POST', '/crew/groups/r1/messages', { eventId, text: 'hi' })).status).toBe(400)
    }
    expect((await send('POST', '/crew/groups/r1/messages', { eventId: 'ok', text: 'hi', threadId: ' t' })).status).toBe(400)
    expect(rpc.send).not.toHaveBeenCalled()
  })
})

describe('turn and discussion calls', () => {
  it('stops and continues', async () => {
    let res = await send('POST', '/crew/groups/r1/stop', { cancelId: 'c1' })
    expect(await res.json()).toEqual({ cancelled: 2 })
    res = await send('POST', '/crew/groups/r1/continue', { discussionEventId: 'd1' })
    expect(res.status).toBe(204)
    expect(rpc.continueDiscussion).toHaveBeenCalledWith('r1', 'd1')
  })

  it('retries the room-wide prepare action through prepareRetry, but never discards it', async () => {
    rooms = [view({ turnActions: [], prepareRetry: { memberId: 'a, b', taskId: 'prepare:r1', executionGeneration: 3 } } as Partial<GroupView>)]
    const prepare = { memberId: 'a, b', taskId: 'prepare:r1', executionGeneration: 3 }
    expect((await send('POST', '/crew/groups/r1/turns/retry', prepare)).status).toBe(204)
    expect(rpc.retry).toHaveBeenCalledWith('r1', prepare)
    expect((await send('POST', '/crew/groups/r1/turns/discard', prepare)).status).toBe(409)
    expect((await send('POST', '/crew/groups/r1/turns/retry', { ...prepare, executionGeneration: 4 })).status).toBe(409)
  })

  it('only retries a turn the room offers', async () => {
    const ok = { memberId: 'a', taskId: 't1', executionGeneration: 2 }
    expect((await send('POST', '/crew/groups/r1/turns/retry', ok)).status).toBe(204)
    expect(rpc.retry).toHaveBeenCalledWith('r1', ok)
    let res = await send('POST', '/crew/groups/r1/turns/retry', { ...ok, taskId: 'other' })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'no_such_action' })
    expect((await send('POST', '/crew/groups/r1/turns/discard', ok)).status).toBe(409)
    expect((await send('POST', '/crew/groups/zz/turns/retry', ok)).status).toBe(404)
    expect((await send('POST', '/crew/groups/r1/turns/retry', { ...ok, executionGeneration: 0 })).status).toBe(400)
  })
})

describe('rename and context', () => {
  it('renames', async () => {
    const res = await send('PATCH', '/crew/groups/r1', { name: ' New ' })
    expect(await res.json()).toEqual({ name: 'New' })
    expect(rpc.rename).toHaveBeenCalledWith('r1', 'New')
  })

  it('requires a seated lead for lead routing', async () => {
    let res = await send('PUT', '/crew/groups/r1/context', { routing: 'lead', purpose: '', notes: '' })
    expect(res.status).toBe(400)
    res = await send('PUT', '/crew/groups/r1/context', { routing: 'lead', leadMemberId: 'zz', purpose: '', notes: '' })
    expect(res.status).toBe(400)
    res = await send('PUT', '/crew/groups/r1/context', { routing: 'lead', leadMemberId: 'a', purpose: 'p', notes: 'n' })
    expect(res.status).toBe(200)
    expect(rpc.setContext).toHaveBeenCalledWith('r1', { routing: 'lead', leadMemberId: 'a', purpose: 'p', notes: 'n' })
    expect((await send('PUT', '/crew/groups/r1/context', { routing: 'auto', purpose: 'x'.repeat(501), notes: '' })).status).toBe(400)
  })
})

describe('DELETE', () => {
  it('stops then disbands with the same id', async () => {
    const res = await send('DELETE', '/crew/groups/r1')
    expect(res.status).toBe(204)
    expect(rpc.stop).toHaveBeenCalledWith('r1', 'id1')
    expect(rpc.disband).toHaveBeenCalledWith('r1', 'id1')
    expect(refreshList).toHaveBeenCalled()
  })

  it('retries while work is stopping, then gives up with 409 after 10 tries', async () => {
    const still = rpcError('room work is still stopping; retry deletion after Stop completes')
    rpc.disband.mockRejectedValueOnce(still).mockRejectedValueOnce(still)
    expect((await send('DELETE', '/crew/groups/r1')).status).toBe(204)
    expect(sleeps).toEqual([1000, 1000])
    rpc.disband.mockReset().mockRejectedValue(still)
    sleeps = []
    const res = await send('DELETE', '/crew/groups/r1')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'still_stopping' })
    expect(rpc.disband).toHaveBeenCalledTimes(10)
    expect(sleeps).toHaveLength(9)
  })
})

describe('DELETE against real Hermes', () => {
  it('treats the internal error (-32603) as still stopping', async () => {
    const internal = new HermesRpcError(-32603, 'internal error')
    rpc.disband.mockRejectedValueOnce(internal).mockRejectedValueOnce(internal)
    expect((await send('DELETE', '/crew/groups/r1')).status).toBe(204)
    expect(sleeps).toEqual([1000, 1000])
    rpc.disband.mockReset().mockRejectedValue(internal)
    const res = await send('DELETE', '/crew/groups/r1')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'still_stopping' })
    expect(rpc.disband).toHaveBeenCalledTimes(10)
  })

  it('still maps other disband errors to 502', async () => {
    rpc.disband.mockRejectedValueOnce(rpcError('boom', { reason: 'x', detail: 'bad' }))
    expect((await send('DELETE', '/crew/groups/r1')).status).toBe(502)
  })
})

describe('errors and guards', () => {
  it('answers 404 for an unknown room and 503 when Hermes is offline', async () => {
    rpc.log.mockRejectedValueOnce(rpcError('denied', { reason: 'permission_denied' }))
    let res = await send('GET', '/crew/groups/zz/events')
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
    rpc.stop.mockRejectedValueOnce(new HermesUnavailableError())
    res = await send('POST', '/crew/groups/r1/stop', { cancelId: 'c' })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'hermes_offline' })
  })

  it('answers 503 without deps', async () => {
    app = createApp({ ...base })
    expect((await send('GET', '/crew/groups/r1/events')).status).toBe(503)
  })

  it('refuses a mutating call without the CSRF header and a read without a cookie', async () => {
    const { 'X-Crew-CSRF': _drop, ...noCsrf } = headers
    expect((await send('POST', '/crew/groups/r1/stop', { cancelId: 'c' }, noCsrf)).status).toBe(403)
    expect((await send('GET', '/crew/groups/r1/events', undefined, { Host: HOST, Origin: ORIGIN })).status).toBe(401)
  })
})
