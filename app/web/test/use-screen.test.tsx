import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeClient } from './fake-client'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))

import { useScreen } from '@/features/computer/use-screen'
import { startScreen } from '@/lib/crew-api'

const status = (over: Record<string, unknown> = {}) => ({
  profile: 'scout', supported: true, installed: true, missing: [], running: false, geometry: '1440x900',
  lease: { holder: 'agent', since: 1, epoch: 1 }, profile_key: '/h/scout', ...over
})
const fetchMock = vi.fn()

beforeEach(() => {
  client.calls = []
  client.handlers = { 'display.status': () => status() }
  client.setState('open')
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'crew_csrf=; Max-Age=0; Path=/'
})

describe('useScreen', () => {
  it('filters display events by profile and refetches after a reconnect', async () => {
    const { result } = renderHook(() => useScreen('scout'))
    await waitFor(() => expect(result.current.view.kind).toBe('off'))
    // Another bot's event is ignored.
    act(() => client.emit({ type: 'display.status', payload: status({ running: true, profile_key: '/h/other' }) }))
    expect(result.current.view.kind).toBe('off')
    act(() => client.emit({ type: 'display.status', payload: status({ running: true }) }))
    expect(result.current.view.kind).toBe('live')
    act(() => client.emit({ type: 'display.lease', payload: { profile_key: '/h/other', lease: { holder: 'human', viewer_hash: 'x', since: 2, epoch: 9 } } }))
    expect(result.current.view.control).toBe('bot')
    act(() => client.emit({ type: 'display.lease', payload: { profile_key: '/h/scout', lease: { holder: 'human', viewer_hash: 'x', since: 2, epoch: 9 } } }))
    expect(result.current.view.control).toBe('someone')

    const before = client.callsOf('display.status').length
    act(() => client.setState('closed'))
    act(() => client.setState('open'))
    await waitFor(() => expect(client.callsOf('display.status').length).toBe(before + 1))
    expect(client.callsOf('display.status').every(c => c.params.profile === 'scout')).toBe(true)
  })

  it('starts through the server route and shows the returned status', async () => {
    document.cookie = 'crew_csrf=tok'
    fetchMock.mockResolvedValue(new Response(JSON.stringify(status({ running: true })), { status: 200 }))
    const { result } = renderHook(() => useScreen('scout'))
    await waitFor(() => expect(result.current.view.kind).toBe('off'))
    await act(async () => { await result.current.start() })
    expect(fetchMock.mock.lastCall![0]).toBe('/crew/bots/scout/screen/start')
    expect(fetchMock.mock.lastCall![1].method).toBe('POST')
    expect(fetchMock.mock.lastCall![1].headers.get('X-Crew-CSRF')).toBe('tok')
    expect(client.callsOf('display.start')).toHaveLength(0)
    expect(result.current.view.kind).toBe('live')
  })

  it('shows the server refusal message when the start fails', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'hermes_error', message: 'Not enough free memory' }), { status: 502 }))
    const { result } = renderHook(() => useScreen('scout'))
    await waitFor(() => expect(result.current.view.kind).toBe('off'))
    await act(async () => { await result.current.start() })
    expect(result.current.view).toMatchObject({ kind: 'error', message: 'Not enough free memory' })
  })

  it('ignores a stale status reply after a newer one', async () => {
    let resolveFirst!: (v: unknown) => void
    let calls = 0
    client.handlers['display.status'] = () => (++calls === 1 ? new Promise(r => { resolveFirst = r }) : status({ running: true }))
    const { result } = renderHook(() => useScreen('scout'))
    await act(async () => { await result.current.refresh() })
    expect(result.current.view.kind).toBe('live')
    await act(async () => { resolveFirst(status()) })
    expect(result.current.view.kind).toBe('live')
  })
})

const lease = (holder: 'agent' | 'human', epoch: number) => ({ holder, viewer_hash: holder === 'human' ? 'h' : null, since: epoch, epoch })
const leaseEvent = (epoch: number) => ({ type: 'display.lease', payload: { profile_key: '/h/scout', lease: lease('human', epoch) } })

describe('useScreen lease ordering', () => {
  beforeEach(() => { client.handlers = { 'display.status': () => status({ running: true }) } })

  it('ignores an older lease event after a newer one', async () => {
    const { result } = renderHook(() => useScreen('scout', 'h'))
    await waitFor(() => expect(result.current.view.kind).toBe('live'))
    act(() => client.emit(leaseEvent(9)))
    expect(result.current.view.control).toBe('you')
    act(() => client.emit({ type: 'display.lease', payload: { profile_key: '/h/scout', lease: lease('agent', 4) } }))
    expect(result.current.view.control).toBe('you')
    act(() => client.emit({ type: 'display.lease', payload: { profile_key: '/h/scout', lease: lease('agent', 10) } }))
    expect(result.current.view.control).toBe('bot')
  })

  it('keeps a newer event lease when an older status reply lands after it', async () => {
    const { result } = renderHook(() => useScreen('scout', 'h'))
    await waitFor(() => expect(result.current.view.kind).toBe('live'))
    let reply!: (v: unknown) => void
    client.handlers['display.status'] = () => new Promise(r => { reply = r })
    let pending!: Promise<unknown>
    act(() => { pending = result.current.refresh() })
    act(() => client.emit(leaseEvent(9)))
    await act(async () => { reply(status({ running: true })); await pending })
    expect(result.current.view.control).toBe('you')
    // A status read that is newer than the event wins and clears it.
    client.handlers['display.status'] = () => status({ running: true, lease: lease('agent', 12) })
    await act(async () => { await result.current.refresh() })
    expect(result.current.view.control).toBe('bot')
  })

  it('applies the lease an acquire returned, by the same epoch rule', async () => {
    const { result } = renderHook(() => useScreen('scout', 'h'))
    await waitFor(() => expect(result.current.view.kind).toBe('live'))
    act(() => result.current.applyLease(lease('human', 7)))
    expect(result.current.view.control).toBe('you')
    act(() => result.current.applyLease(lease('agent', 3)))
    expect(result.current.view.control).toBe('you')
  })
})

describe('useScreen failures', () => {
  it('keeps a running screen live with a notice when a refresh fails or a stop is refused', async () => {
    client.handlers = { 'display.status': () => status({ running: true }) }
    const { result } = renderHook(() => useScreen('scout'))
    await waitFor(() => expect(result.current.view.kind).toBe('live'))
    client.handlers['display.status'] = () => { throw new Error('gateway down') }
    await act(async () => { await result.current.refresh() })
    expect(result.current.view).toMatchObject({ kind: 'live', notice: 'gateway down' })
    expect(result.current.view.status?.running).toBe(true)
    client.handlers['display.stop'] = () => { throw new Error('a human holds this screen') }
    await act(async () => { await result.current.stop() })
    expect(result.current.view).toMatchObject({ kind: 'live', notice: 'a human holds this screen' })
  })

  it('does not read the status until the gateway is open, so a page load shows no error', async () => {
    client.setState('connecting')
    client.handlers['display.status'] = () => { throw new Error('not connected') }
    const { result } = renderHook(() => useScreen('scout'))
    expect(client.callsOf('display.status')).toHaveLength(0)
    expect(result.current.view.kind).toBe('loading')
    client.handlers['display.status'] = () => status()
    act(() => client.setState('open'))
    await waitFor(() => expect(result.current.view.kind).toBe('off'))
  })
})

describe('screen routes in crew-api', () => {
  it('uses the server route to start a screen, and reads and writes the config', async () => {
    document.cookie = 'crew_csrf=tok'
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ running: true }), { status: 200 }))
    await startScreen('scout')
    expect(fetchMock.mock.lastCall![0]).toBe('/crew/bots/scout/screen/start')
    const { getScreenConfig, setUseScreen } = await import('@/lib/crew-api')
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ useScreen: false, idleStopMinutes: 15 }), { status: 200 }))
    expect(await getScreenConfig('scout')).toEqual({ useScreen: false, idleStopMinutes: 15 })
    expect(fetchMock.mock.lastCall![0]).toBe('/crew/bots/scout/screen/config')
    await setUseScreen('scout', true)
    expect(fetchMock.mock.lastCall![1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual({ useScreen: true })
  })
  it('shows readable text for known server codes and never a raw code', async () => {
    const { getScreenConfig } = await import('@/lib/crew-api')
    const answer = (body: unknown, status = 502) => fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }))
    const cases: [unknown, string][] = [
      [{ error: 'hermes_offline' }, 'Hermes is offline'],
      [{ error: 'not_found' }, 'That bot no longer exists'],
      [{ error: 'primary_not_supported' }, 'Not available for the primary bot'],
      [{ error: 'screen_config_failed' }, "Couldn't save the screen settings"],
      [{ error: 'bad_body' }, 'Something went wrong. Try again.'],
      [{ error: 'some_new_code' }, 'Something went wrong. Try again.'],
      [{}, 'Something went wrong. Try again.'],
      [{ error: 'hermes_error', message: 'Not enough free memory' }, 'Not enough free memory']
    ]
    for (const [body, text] of cases) {
      answer(body)
      await expect(getScreenConfig('scout')).rejects.toThrow(text)
    }
  })
})
