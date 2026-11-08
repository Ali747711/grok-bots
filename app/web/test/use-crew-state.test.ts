import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useCrewState } from '@/state/use-crew-state'

import { crewState } from './fixtures'

class FakeEventSource {
  static instances: FakeEventSource[] = []
  onopen: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  private listeners = new Map<string, (e: MessageEvent) => void>()
  constructor(public url: string) { FakeEventSource.instances.push(this) }
  addEventListener(type: string, l: (e: MessageEvent) => void) { this.listeners.set(type, l) }
  close() { this.closed = true }
  emit(type: string, data: string) { this.listeners.get(type)?.({ data } as MessageEvent) }
}

const fetchMock = vi.fn()

beforeEach(() => {
  FakeEventSource.instances = []
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
  vi.stubGlobal('EventSource', FakeEventSource)
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

const source = () => FakeEventSource.instances[0]!

describe('useCrewState', () => {
  it('opens /crew/events and starts with no state', () => {
    const { result } = renderHook(() => useCrewState())
    expect(source().url).toBe('/crew/events')
    expect(result.current).toEqual({ state: null, connected: false })
  })

  it('updates when a new state event arrives', () => {
    const { result } = renderHook(() => useCrewState())
    act(() => source().onopen?.())
    expect(result.current.connected).toBe(true)
    act(() => source().emit('state', JSON.stringify(crewState())))
    expect(result.current.state?.bots).toHaveLength(3)
    act(() => source().emit('state', JSON.stringify(crewState({ hermes: 'offline', bots: [] }))))
    expect(result.current.state?.hermes).toBe('offline')
  })

  it('ignores malformed events', () => {
    const { result } = renderHook(() => useCrewState())
    act(() => source().emit('state', 'not json'))
    act(() => source().emit('state', '{"x":1}'))
    expect(result.current.state).toBeNull()
  })

  it('marks disconnected on error and probes /crew/state so a 401 redirects to login', () => {
    const { result } = renderHook(() => useCrewState())
    act(() => source().onopen?.())
    act(() => source().onerror?.())
    expect(result.current.connected).toBe(false)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/crew/state')
  })

  it('closes the stream on unmount', () => {
    const { unmount } = renderHook(() => useCrewState())
    unmount()
    expect(source().closed).toBe(true)
  })
})
