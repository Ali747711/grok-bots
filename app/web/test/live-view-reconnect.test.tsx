import { createHash } from 'node:crypto'

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeClient } from './fake-client'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))

const rfbs = vi.hoisted(() => ({ list: [] as unknown[] }))
vi.mock('@novnc/novnc', () => {
  class FakeRfb {
    viewOnly = false
    scaleViewport = false
    disconnects = 0
    pastes: string[] = []
    log: string[] = []
    private listeners = new Map<string, ((e: unknown) => void)[]>()
    constructor(public target: HTMLElement, public socket: unknown, public options: unknown) { rfbs.list.push(this) }
    addEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]) }
    emit(type: string, detail: unknown = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ detail }) }
    disconnect() { this.disconnects += 1 }
    focusOnClick = true
    blurs = 0
    focus() {}
    blur() { this.blurs += 1 }
    clipboardPasteFrom(text: string) { this.pastes.push(text); this.log.push(`paste:${text.length}`) }
    sendKey(keysym: number, code: string, down?: boolean) { this.log.push(`key:${keysym}:${code}${down === undefined ? '' : down ? ':down' : ':up'}`) }
  }
  return { default: FakeRfb }
})

type Listener = (e: unknown) => void
class FakeSocket {
  static instances: FakeSocket[] = []
  binaryType = ''
  closedWith: (number | undefined)[] = []
  private listeners = new Map<string, Listener[]>()
  constructor(public url: string) { FakeSocket.instances.push(this) }
  addEventListener(type: string, fn: Listener) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]) }
  close(code?: number) { this.closedWith.push(code) }
  serverClose(code: number) { for (const fn of this.listeners.get('close') ?? []) fn({ code }) }
}

import { createDialBudget } from '@/features/computer/dial-budget'
import { ControlBar } from '@/features/computer/ControlBar'
import { LiveView } from '@/features/computer/LiveView'
import { useComputer } from '@/features/computer/use-live-view'

interface FakeRfbShape { focusOnClick: boolean; blurs: number; log: string[]; options: unknown; viewOnly: boolean; disconnects: number; pastes: string[]; target: HTMLElement; socket: FakeSocket; emit(type: string, detail?: unknown): void }
const lastRfb = () => rfbs.list.at(-1) as FakeRfbShape
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 12)

let lease: { holder: string; viewer_hash: string | null; since: number; epoch: number }
let minted: number
let forceNewId: boolean
let running: boolean
const status = (over: Record<string, unknown> = {}) => ({
  profile: 'scout', supported: true, installed: true, missing: [], running, geometry: '1440x900', profile_key: '/h/scout', lease, ...over
})

function script() {
  client.handlers = {
    'display.status': () => status(),
    'display.observe': p => {
      const id = !forceNewId && typeof p.viewer_id === 'string' ? p.viewer_id : `v${++minted}`
      forceNewId = false
      return { ...status(), viewer_id: id, ticket: `tkt-${minted}-${id}`, path: '/api/display/ws' }
    },
    'display.lease.acquire': p => {
      lease = { holder: 'human', viewer_hash: hashOf(p.viewer_id as string), since: 2, epoch: lease.epoch + 1 }
      return { lease }
    },
    'display.lease.release': () => {
      lease = { holder: 'agent', viewer_hash: null, since: 3, epoch: lease.epoch + 1 }
      return { lease }
    }
  }
}

let budget = createDialBudget({ max: 50, windowMs: 10_000, mountDelayMs: 0 })

// `view.control`, spelled out. The app says it in the side panel's link chip (R11); here it is only a probe.
const WHO = { bot: 'Bot is in control', you: "You're in control", someone: 'Someone is in control' } as const

function Owner({ where = 'panel', ask = true }: { where?: 'panel' | 'expand'; ask?: boolean }) {
  const { screen: s, live } = useComputer('scout', { budget })
  return (
    <>
      <span data-testid="link">{live.link}</span>
      <span data-testid="error">{live.error ?? ''}</span>
      <span data-testid="notice">{live.notice ?? ''}</span>
      <span data-testid="control">{WHO[s.view.control]}</span>
      <div data-testid="panel">{ask && where === 'panel' && <LiveView live={live} />}</div>
      <div data-testid="expand">{ask && where === 'expand' && <LiveView live={live} />}</div>
      <ControlBar connected={live.link === 'live'} control={s.view.control} botTitle="Scout" onTake={() => void live.takeControl()} onHandBack={() => void live.handBack()} onForce={() => void live.forceHandBack()} />
    </>
  )
}

const calls = (m: string) => client.callsOf(m)
const waitRfb = async (n: number) => waitFor(() => expect(rfbs.list.length).toBe(n))
const connect = async (n = 1) => { await waitRfb(n); act(() => lastRfb().emit('connect')); await waitFor(() => expect(screen.getByTestId('link')).toHaveTextContent('live')) }
const take = async () => { fireEvent.click(screen.getByRole('button', { name: 'Take control' })); await waitFor(() => expect(screen.getByText("You're in control")).toBeInTheDocument()) }

beforeEach(() => {
  FakeSocket.instances = []
  rfbs.list = []
  client.calls = []
  client.setState('open')
  lease = { holder: 'agent', viewer_hash: null, since: 1, epoch: 1 }
  minted = 0
  forceNewId = false
  running = true
  budget = createDialBudget({ max: 50, windowMs: 10_000, mountDelayMs: 0 })
  script()
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('live view reconnect', () => {
  it('follows the close-code table', async () => {
    const cases: { code: number; observes: boolean; refreshes: boolean; link?: string }[] = [
      { code: 1000, observes: false, refreshes: true, link: 'idle' },
      { code: 4001, observes: false, refreshes: true, link: 'idle' },
      { code: 1003, observes: false, refreshes: false, link: 'failed' },
      { code: 4403, observes: false, refreshes: false, link: 'failed' },
      { code: 4000, observes: true, refreshes: false },
      { code: 4401, observes: true, refreshes: false },
      { code: 1006, observes: true, refreshes: false },
      { code: 1012, observes: true, refreshes: false },
      { code: 1013, observes: true, refreshes: false }
    ]
    for (const c of cases) {
      FakeSocket.instances = []
      rfbs.list = []
      client.calls = []
      minted = 0
      budget = createDialBudget({ max: 50, windowMs: 10_000, mountDelayMs: 0 })
      running = true
      const { unmount } = render(<Owner />)
      await connect()
      if (c.code === 1000 || c.code === 4001) running = false
      const statusReads = calls('display.status').length
      act(() => FakeSocket.instances[0]!.serverClose(c.code))
      if (c.observes) {
        await waitFor(() => expect(calls('display.observe')).toHaveLength(2))
        expect(calls('display.observe')[1]!.params).toEqual({ profile: 'scout', viewer_id: 'v1' })
      } else {
        await new Promise(r => setTimeout(r, 30))
        expect(calls('display.observe'), `code ${c.code}`).toHaveLength(1)
      }
      if (c.refreshes) await waitFor(() => expect(calls('display.status').length).toBeGreaterThan(statusReads))
      if (c.link) expect(screen.getByTestId('link'), `code ${c.code}`).toHaveTextContent(c.link)
      unmount()
    }
  })
  it('waits 12 s after a security failure, then redials once', async () => {
    render(<Owner />)
    await connect()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => lastRfb().emit('securityfailure', { status: 1, reason: 'Too many security failures' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(11_900) })
    expect(calls('display.observe')).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(calls('display.observe')).toHaveLength(2)
  })
  it('force-releases our own lease after a gateway redial', async () => {
    render(<Owner />)
    await connect()
    await take()
    act(() => client.setState('closed'))
    act(() => client.setState('open'))
    fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
    await waitFor(() => expect(calls('display.lease.release')).toHaveLength(1))
    expect(calls('display.lease.release')[0]!.params).toEqual({ profile: 'scout', force: true })
  })
  it('re-acquires when the pixel socket redials while we held control', async () => {
    render(<Owner />)
    await connect()
    await take()
    forceNewId = true // the gateway socket redialed too, so the old id is orphaned
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    await waitFor(() => expect(calls('display.lease.acquire')).toHaveLength(2))
    expect(calls('display.lease.acquire')[1]!.params).toEqual({ profile: 'scout', viewer_id: 'v2' })
    await waitRfb(2)
    expect(lastRfb().viewOnly).toBe(false)
  })
  it('detaches after five hidden minutes and re-attaches when visible', async () => {
    render(<Owner />)
    await connect()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000 - 1000) })
    expect(rfbs.list[0] && (rfbs.list[0] as FakeRfbShape).disconnects).toBe(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect((rfbs.list[0] as FakeRfbShape).disconnects).toBe(1)
    expect(calls('display.lease.release')).toHaveLength(0)
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    vi.useRealTimers() // the import() behind the redial needs real ticks
    await waitRfb(2)
    expect(calls('display.observe')[1]!.params).toEqual({ profile: 'scout', viewer_id: 'v1' })
  })
  it('does not detach when the tab becomes visible again within five minutes', async () => {
    render(<Owner />)
    await connect()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
    expect((rfbs.list[0] as FakeRfbShape).disconnects).toBe(0)
  })
  it('stops redialing when the budget is spent and offers Reconnect', async () => {
    budget = createDialBudget({ max: 1, windowMs: 10_000, mountDelayMs: 0 })
    render(<Owner />)
    await connect()
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    await waitFor(() => expect(screen.getByTestId('link')).toHaveTextContent('failed'))
    expect(calls('display.observe')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }))
    await waitRfb(2)
  })
  it('redials once after a 1000 close when the screen is still running', async () => {
    render(<Owner />)
    await connect()
    act(() => FakeSocket.instances[0]!.serverClose(1000))
    await waitFor(() => expect(calls('display.observe')).toHaveLength(2))
    await waitRfb(2)
  })
  it('starts the hidden timer at once when the page is already hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true })
    const timers = vi.spyOn(globalThis, 'setTimeout')
    render(<Owner />)
    await waitRfb(1)
    expect(timers).toHaveBeenCalledWith(expect.any(Function), 5 * 60_000)
    timers.mockRestore()
  })
  it('fails after a second consecutive security failure and offers Reconnect', async () => {
    render(<Owner />)
    await connect()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    act(() => lastRfb().emit('securityfailure', {}))
    await act(async () => { await vi.advanceTimersByTimeAsync(12_100) })
    vi.useRealTimers()
    await waitRfb(2)
    act(() => lastRfb().emit('securityfailure', {}))
    await waitFor(() => expect(screen.getByTestId('link')).toHaveTextContent('failed'))
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument()
  })
  it('says the budget message neutrally', async () => {
    budget = createDialBudget({ max: 1, windowMs: 10_000, mountDelayMs: 0 })
    render(<Owner />)
    await connect()
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent("Couldn't reconnect to the screen. Try again."))
  })
})

describe('live view recovery', () => {
  it('names our own orphaned lease as "You" after a pixel redial', async () => {
    render(<Owner />)
    await connect()
    await take()
    forceNewId = true
    client.handlers['display.lease.acquire'] = () => { throw Object.assign(new Error('acquire refused'), { code: 5300 }) }
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    await waitFor(() => expect(calls('display.observe')).toHaveLength(2))
    await waitFor(() => expect(screen.getByTestId('link')).toHaveTextContent('failed'))
    expect(screen.getByText("You're in control")).toBeInTheDocument()
  })

  it('force-releases our old lease when the reclaim failed and the user leaves', async () => {
    const { unmount } = render(<Owner />)
    await connect()
    await take()
    forceNewId = true
    client.handlers['display.lease.acquire'] = () => { throw Object.assign(new Error('acquire refused'), { code: 5300 }) }
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    await waitFor(() => expect(screen.getByTestId('link')).toHaveTextContent('failed'))
    unmount()
    await waitFor(() => expect(calls('display.lease.release')).toHaveLength(1))
    expect(calls('display.lease.release')[0]!.params).toEqual({ profile: 'scout', force: true })
  })

  it('releases a lease acquired by an in-flight reclaim when the owner leaves meanwhile', async () => {
    const { unmount } = render(<Owner />)
    await connect()
    await take()
    forceNewId = true
    let finish!: () => void
    client.handlers['display.lease.acquire'] = p => new Promise(resolve => {
      finish = () => {
        lease = { holder: 'human', viewer_hash: hashOf(p.viewer_id as string), since: 5, epoch: lease.epoch + 1 }
        resolve({ lease })
      }
    })
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    await waitFor(() => expect(calls('display.lease.acquire')).toHaveLength(2))
    unmount()
    await act(async () => { finish(); await new Promise(r => setTimeout(r, 20)) })
    const releases = calls('display.lease.release')
    expect(releases.length).toBeGreaterThan(0)
    expect(releases.at(-1)!.params).toEqual({ profile: 'scout', force: true })
  })

  it('waits for the gateway instead of failing when the pixel socket closes during an outage', async () => {
    render(<Owner />)
    await connect()
    act(() => client.setState('closed'))
    client.handlers['display.observe'] = () => { throw new Error('gateway is not connected') }
    act(() => FakeSocket.instances[0]!.serverClose(1012))
    await waitFor(() => expect(calls('display.observe')).toHaveLength(2))
    await new Promise(r => setTimeout(r, 30))
    expect(screen.getByTestId('link')).toHaveTextContent('reconnecting')
    expect(calls('display.observe')).toHaveLength(2)
    script()
    act(() => client.setState('open'))
    await waitRfb(2)
  })

  it('goes idle and refreshes when observe says the screen is not running', async () => {
    render(<Owner />)
    await connect()
    const reads = calls('display.status').length
    client.handlers['display.observe'] = () => { throw Object.assign(new Error("this profile's Bot Desktop is not running; call display.start first"), { code: 5300 }) }
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    await waitFor(() => expect(calls('display.status').length).toBeGreaterThan(reads))
    expect(screen.getByTestId('link')).toHaveTextContent('idle')
  })

  it('re-attaches before acquiring when the gateway redialed since the id was minted', async () => {
    render(<Owner />)
    await connect()
    act(() => client.setState('closed'))
    act(() => client.setState('open'))
    forceNewId = true
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await waitFor(() => expect(calls('display.lease.acquire')).toHaveLength(1))
    expect(calls('display.observe')).toHaveLength(2)
    expect(calls('display.lease.acquire')[0]!.params).toEqual({ profile: 'scout', viewer_id: 'v2' })
    await waitFor(() => expect(screen.getByText("You're in control")).toBeInTheDocument())
  })
  it('does not release a reclaim acquire that lands during a detach gap', async () => {
    const { rerender } = render(<Owner ask />)
    await connect()
    await take()
    forceNewId = true
    let finish!: () => void
    client.handlers['display.lease.acquire'] = p => new Promise(resolve => {
      finish = () => {
        lease = { holder: 'human', viewer_hash: hashOf(p.viewer_id as string), since: 5, epoch: lease.epoch + 1 }
        resolve({ lease })
      }
    })
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    await waitFor(() => expect(calls('display.lease.acquire')).toHaveLength(2))
    rerender(<Owner ask={false} />) // the Expand portal gap: detached, not disposed
    await act(async () => { await Promise.resolve() })
    await act(async () => { finish(); await new Promise(r => setTimeout(r, 20)) })
    expect(calls('display.lease.release')).toHaveLength(0)
  })

  it('keeps the link live and shows a notice when the deferred acquire is refused', async () => {
    render(<Owner />)
    await connect()
    act(() => client.setState('closed'))
    act(() => client.setState('open'))
    forceNewId = true
    client.handlers['display.lease.acquire'] = () => { throw Object.assign(new Error('acquire refused'), { code: 5300 }) }
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await waitFor(() => expect(calls('display.lease.acquire')).toHaveLength(1))
    await waitRfb(2)
    act(() => lastRfb().emit('connect'))
    await waitFor(() => expect(screen.getByTestId('link')).toHaveTextContent('live'))
    expect(screen.getByTestId('notice')).toHaveTextContent('acquire refused')
  })
  it('still caps a 4000 ping-pong at three dials', async () => {
    budget = createDialBudget({ max: 3, windowMs: 10_000, mountDelayMs: 0 })
    render(<Owner />)
    for (let n = 1; n <= 3; n++) {
      await connect(n)
      act(() => FakeSocket.instances[n - 1]!.serverClose(4000))
    }
    await waitFor(() => expect(screen.getByTestId('link')).toHaveTextContent('failed'))
    expect(calls('display.observe')).toHaveLength(3)
    expect(rfbs.list).toHaveLength(3)
  })
})
