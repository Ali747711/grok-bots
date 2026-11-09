import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { hashEventId } from '@/features/groups/room-reducer'
import type { GroupEvent, GroupView } from '@/state/types'

import { group, gm } from './fixtures'

const api = vi.hoisted(() => ({
  fetchGroupEvents: vi.fn(),
  sendGroupMessage: vi.fn(),
  stopGroup: vi.fn(),
  continueGroup: vi.fn(),
  retryTurn: vi.fn(),
  discardTurn: vi.fn()
}))
vi.mock('@/features/groups/groups-api', () => api)

const { useGroupRoom } = await import('@/features/groups/use-group-room')

const ev = (seq: number, over: Partial<GroupEvent> = {}): GroupEvent => ({
  seq, eventId: `e${seq}`, kind: 'message.user', createdAt: seq, actor: { kind: 'user', id: 'desktop', profile: null, displayName: null }, text: `m${seq}`, threadId: 't1', ...over
})
const page = (events: GroupEvent[], over: Record<string, unknown> = {}) => ({ events, cursor: events.at(-1)?.seq ?? 0, latestSeq: events.at(-1)?.seq ?? 0, hasMore: false, epoch: 1, ...over })
const view = (over: Partial<GroupView> = {}): GroupView => group({ id: 'r1', members: [gm('a'), gm('b')], epoch: 1, latestSeq: 3, ...over })
const titleOf = (id: string): string => id
const setup = (v: GroupView = view()) => renderHook(({ v, online }) => useGroupRoom(v, titleOf, online), { initialProps: { v, online: true } })

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.fetchGroupEvents.mockResolvedValue(page([ev(1), ev(2), ev(3)]))
  api.stopGroup.mockResolvedValue({ cancelled: true })
})

describe('useGroupRoom loading', () => {
  it('loads the last 300 events and marks history cut', async () => {
    api.fetchGroupEvents.mockResolvedValue(page([ev(501)], { cursor: 501 }))
    const { result } = setup(view({ latestSeq: 501 }))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(api.fetchGroupEvents).toHaveBeenCalledWith('r1', 201)
    expect(result.current.cut).toBe(true)
    expect(result.current.items).toHaveLength(1)
  })

  it('does not mark a short history cut and pages while hasMore', async () => {
    api.fetchGroupEvents
      .mockResolvedValueOnce(page([ev(1), ev(2)], { hasMore: true }))
      .mockResolvedValueOnce(page([ev(3)]))
    const { result } = setup()
    await waitFor(() => expect(result.current.items).toHaveLength(3))
    expect(api.fetchGroupEvents).toHaveBeenNthCalledWith(1, 'r1', 0)
    expect(api.fetchGroupEvents).toHaveBeenNthCalledWith(2, 'r1', 2)
    expect(result.current.cut).toBe(false)
  })

  it('fetches only new events when latestSeq moves', async () => {
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.items).toHaveLength(3))
    api.fetchGroupEvents.mockResolvedValue(page([ev(4)]))
    rerender({ v: view({ latestSeq: 4 }), online: true })
    await waitFor(() => expect(result.current.items).toHaveLength(4))
    expect(api.fetchGroupEvents).toHaveBeenLastCalledWith('r1', 3)
    expect(api.fetchGroupEvents).toHaveBeenCalledTimes(2)
  })

  it('reloads when the epoch changes', async () => {
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.items).toHaveLength(3))
    api.fetchGroupEvents.mockResolvedValue(page([ev(1, { text: 'fresh' })], { epoch: 2 }))
    rerender({ v: view({ epoch: 2, latestSeq: 1 }), online: true })
    await waitFor(() => expect(result.current.items).toHaveLength(1))
    expect(api.fetchGroupEvents).toHaveBeenLastCalledWith('r1', 0)
    expect(result.current.items[0]).toMatchObject({ text: 'fresh' })
  })
})

describe('useGroupRoom sending', () => {
  it('continues the current topic unless a new topic is asked for', async () => {
    api.sendGroupMessage.mockResolvedValue({ kind: 'accepted', seq: 9 })
    const { result } = setup()
    await waitFor(() => expect(result.current.topic).toBe('t1'))
    await act(() => result.current.send('hi', { newTopic: false }))
    expect(api.sendGroupMessage.mock.calls[0]![1]).toMatchObject({ text: 'hi', threadId: 't1' })
    await act(() => result.current.send('again', { newTopic: true }))
    expect(api.sendGroupMessage.mock.calls[1]![1].threadId).toBeUndefined()
  })

  it('retries an unknown send once with the same eventId, then offers Retry', async () => {
    api.sendGroupMessage.mockResolvedValue({ kind: 'unknown' })
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.send('hi', { newTopic: false }))
    expect(api.sendGroupMessage).toHaveBeenCalledTimes(2)
    expect(api.sendGroupMessage.mock.calls[1]![1].eventId).toBe(api.sendGroupMessage.mock.calls[0]![1].eventId)
    const last = result.current.items.at(-1)!
    expect(last).toMatchObject({ kind: 'user', status: 'unknown' })
    api.sendGroupMessage.mockResolvedValue({ kind: 'accepted', seq: 5 })
    await act(() => result.current.retrySend((last as { eventId: string }).eventId))
    expect(api.sendGroupMessage.mock.calls[2]![1].eventId).toBe(api.sendGroupMessage.mock.calls[0]![1].eventId)
  })

  it('marks a refused send and retries it with a new eventId', async () => {
    api.sendGroupMessage.mockResolvedValueOnce({ kind: 'refused', reason: 'room_busy' })
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.send('hi', { newTopic: false }))
    expect(api.sendGroupMessage).toHaveBeenCalledTimes(1)
    const refused = result.current.items.at(-1)!
    expect(refused).toMatchObject({ status: 'refused', error: 'Not sent: room_busy' })
    api.sendGroupMessage.mockResolvedValue({ kind: 'accepted', seq: 5 })
    await act(() => result.current.retrySend((refused as { eventId: string }).eventId))
    expect(api.sendGroupMessage.mock.calls[1]![1].eventId).not.toBe(api.sendGroupMessage.mock.calls[0]![1].eventId)
    expect(api.sendGroupMessage.mock.calls[1]![1].text).toBe('hi')
  })

  it('reuses the cancel id when Stop is retried', async () => {
    api.stopGroup.mockRejectedValueOnce(new Error('x')).mockResolvedValue({ cancelled: true })
    const { result } = setup()
    await waitFor(() => expect(result.current.loading).toBe(false))
    await act(() => result.current.stop())
    await act(() => result.current.stop())
    await act(() => result.current.stop())
    const ids = api.stopGroup.mock.calls.map(c => c[1])
    expect(ids[1]).toBe(ids[0])
    expect(ids[2]).not.toBe(ids[0])
  })
})

describe('useGroupRoom topic and recovery', () => {
  it('follows a newer thread from another client after a Crew send landed', async () => {
    api.sendGroupMessage.mockResolvedValue({ kind: 'accepted', seq: 4 })
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.topic).toBe('t1'))
    await act(() => result.current.send('hi', { newTopic: true }))
    const sent = api.sendGroupMessage.mock.calls[0]![1].eventId as string
    const hash = await hashEventId(sent)
    api.fetchGroupEvents.mockResolvedValue(page([ev(4, { eventId: hash, threadId: sent }), ev(5, { threadId: 'from-webapp' })]))
    rerender({ v: view({ latestSeq: 5 }), online: true })
    await waitFor(() => expect(result.current.topic).toBe('from-webapp'))
  })

  it('shows an error after a failed fetch and recovers on reconnect', async () => {
    api.fetchGroupEvents.mockRejectedValueOnce(new Error('Hermes is offline'))
    const { result, rerender } = setup()
    await waitFor(() => expect(result.current.error).toBe('Hermes is offline'))
    rerender({ v: view(), online: false })
    rerender({ v: view(), online: true })
    await waitFor(() => expect(result.current.items).toHaveLength(3))
    expect(result.current.error).toBeNull()
  })

  it('retries on demand', async () => {
    api.fetchGroupEvents.mockRejectedValueOnce(new Error('boom'))
    const { result } = setup()
    await waitFor(() => expect(result.current.error).toBe('boom'))
    await act(() => result.current.retry())
    await waitFor(() => expect(result.current.items).toHaveLength(3))
    expect(result.current.error).toBeNull()
  })
})
