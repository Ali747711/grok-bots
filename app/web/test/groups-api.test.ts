import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createGroup, deleteGroup, fetchGroupEvents, GroupApiError, sendGroupMessage, setGroupContext } from '@/features/groups/groups-api'

const fetchMock = vi.fn()
const json = (status: number, body: unknown): Response => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  document.cookie = 'crew_csrf=tok'
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'crew_csrf=; Max-Age=0; Path=/'
})

describe('sendGroupMessage', () => {
  const body = { eventId: 'e1', text: 'hi' }
  it('accepts with the seq', async () => {
    fetchMock.mockResolvedValue(json(202, { accepted: true, seq: 7 }))
    expect(await sendGroupMessage('r1', body)).toEqual({ kind: 'accepted', seq: 7 })
  })
  it('refuses on 409 with the server reason', async () => {
    fetchMock.mockResolvedValue(json(409, { admitted: false, reason: 'room_busy' }))
    expect(await sendGroupMessage('r1', body)).toEqual({ kind: 'refused', reason: 'room_busy' })
  })
  it('refuses with hermes_offline on 503', async () => {
    fetchMock.mockResolvedValue(json(503, { error: 'hermes_offline', admitted: false }))
    expect(await sendGroupMessage('r1', body)).toEqual({ kind: 'refused', reason: 'hermes_offline' })
  })
  it('is unknown on 502 and on a network error', async () => {
    fetchMock.mockResolvedValue(json(502, { admitted: 'unknown' }))
    expect(await sendGroupMessage('r1', body)).toEqual({ kind: 'unknown' })
    fetchMock.mockRejectedValue(new TypeError('network'))
    expect(await sendGroupMessage('r1', body)).toEqual({ kind: 'unknown' })
  })
})

describe('other calls', () => {
  it('createGroup posts JSON with the csrf header', async () => {
    fetchMock.mockResolvedValue(json(201, { roomId: 'r1', routing: 'auto' }))
    expect(await createGroup({ members: ['a', 'b'] })).toEqual({ roomId: 'r1', routing: 'auto' })
    const [path, init] = fetchMock.mock.lastCall!
    expect(path).toBe('/crew/groups')
    expect(init.method).toBe('POST')
    expect(init.headers.get('X-Crew-CSRF')).toBe('tok')
    expect(JSON.parse(init.body)).toEqual({ members: ['a', 'b'] })
  })
  it('fetchGroupEvents builds the query', async () => {
    fetchMock.mockResolvedValue(json(200, { events: [], cursor: 3, latestSeq: 3, hasMore: false, epoch: 1 }))
    await fetchGroupEvents('r 1', 2)
    expect(fetchMock.mock.lastCall![0]).toBe('/crew/groups/r%201/events?since=2&limit=100')
  })
  it('throws a GroupApiError with plain words', async () => {
    fetchMock.mockResolvedValue(json(409, { error: 'groups_unavailable' }))
    const err = await createGroup({ members: ['a', 'b'] }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(GroupApiError)
    expect(err).toMatchObject({ status: 409, code: 'groups_unavailable' })
    expect((err as GroupApiError).message).not.toContain('groups_unavailable')
  })
  it('shows Hermes words for hermes_refused', async () => {
    fetchMock.mockResolvedValue(json(502, { error: 'hermes_refused', detail: 'room is stopping' }))
    await expect(setGroupContext('r1', { routing: 'auto', purpose: '', notes: '' })).rejects.toMatchObject({ message: 'room is stopping' })
  })
  it('deleteGroup resolves on 204', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(deleteGroup('r1')).resolves.toBeUndefined()
    expect(fetchMock.mock.lastCall![1].method).toBe('DELETE')
  })
})
