import { createHash } from 'node:crypto'

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    private listeners = new Map<string, ((e: unknown) => void)[]>()
    constructor(public target: HTMLElement, public socket: unknown, public options: unknown) { rfbs.list.push(this) }
    addEventListener(type: string, fn: (e: unknown) => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]) }
    emit(type: string, detail: unknown = {}) { for (const fn of this.listeners.get(type) ?? []) fn({ detail }) }
    disconnect() { this.disconnects += 1 }
    focus() {}
    clipboardPasteFrom(text: string) { this.pastes.push(text) }
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

interface FakeRfbShape { options: unknown; viewOnly: boolean; disconnects: number; pastes: string[]; target: HTMLElement; socket: FakeSocket; emit(type: string, detail?: unknown): void }
const lastRfb = () => rfbs.list.at(-1) as FakeRfbShape
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 12)

let lease: { holder: string; viewer_hash: string | null; since: number; epoch: number }
let minted: number
let forceNewId: boolean
const status = (over: Record<string, unknown> = {}) => ({
  profile: 'scout', supported: true, installed: true, missing: [], running: true, geometry: '1440x900', profile_key: '/h/scout', lease, ...over
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

function Owner({ where = 'panel', ask = true }: { where?: 'panel' | 'expand'; ask?: boolean }) {
  const { screen: s, live } = useComputer('scout', { budget })
  return (
    <>
      <span data-testid="link">{live.link}</span>
      <span data-testid="error">{live.error ?? ''}</span>
      <div data-testid="panel">{ask && where === 'panel' && <LiveView live={live} />}</div>
      <div data-testid="expand">{ask && where === 'expand' && <LiveView live={live} />}</div>
      <ControlBar control={s.view.control} botTitle="Scout" onTake={() => void live.takeControl()} onHandBack={() => void live.handBack()} onForce={() => void live.forceHandBack()} />
    </>
  )
}

const live = async () => { await waitFor(() => expect(screen.getByTestId('link')).toHaveTextContent('connecting')); }
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
  budget = createDialBudget({ max: 50, windowMs: 10_000, mountDelayMs: 0 })
  script()
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
})

describe('live view', () => {
  it('observes with the profile, dials the display socket and mounts RFB watch-only', async () => {
    render(<Owner />)
    await waitRfb(1)
    expect(calls('display.observe')[0]!.params).toEqual({ profile: 'scout' })
    expect(FakeSocket.instances[0]!.url).toMatch(/^wss?:\/\/[^/]+\/api\/display\/ws\?display_ticket=tkt-1-v1$/)
    expect(FakeSocket.instances[0]!.binaryType).toBe('arraybuffer')
    expect(lastRfb().options).toMatchObject({ shared: true })
    expect(lastRfb().socket).toBe(FakeSocket.instances[0])
    expect(lastRfb().viewOnly).toBe(true)
    expect(lastRfb().target).toBe(within(screen.getByTestId('panel')).getByTestId('live-view').firstElementChild)
    expect(screen.getByText('Bot is in control')).toBeInTheDocument()
  })

  it('takes control and hands back on the same gateway socket', async () => {
    render(<Owner />)
    await connect()
    await take()
    expect(calls('display.lease.acquire')[0]!.params).toEqual({ profile: 'scout', viewer_id: 'v1' })
    expect(lastRfb().viewOnly).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
    await waitFor(() => expect(screen.getByText('Bot is in control')).toBeInTheDocument())
    expect(calls('display.lease.release')[0]!.params).toEqual({ profile: 'scout', viewer_id: 'v1' })
    expect(lastRfb().viewOnly).toBe(true)
  })

  it('keeps control when the view moves between the panel and Expand', async () => {
    const { rerender } = render(<Owner where="panel" />)
    await connect()
    await take()
    const first = lastRfb()
    const firstSocket = FakeSocket.instances[0]!
    rerender(<Owner where="expand" />)
    await waitRfb(2)
    expect(first.disconnects).toBe(1)
    expect(calls('display.lease.release')).toHaveLength(0)
    expect(firstSocket.closedWith).not.toContain(1000)
    expect(calls('display.observe')).toHaveLength(2)
    expect(calls('display.observe')[1]!.params).toEqual({ profile: 'scout', viewer_id: 'v1' })
    expect(lastRfb().target).toBe(within(screen.getByTestId('expand')).getByTestId('live-view').firstElementChild)
    act(() => lastRfb().emit('connect'))
    expect(screen.getByText("You're in control")).toBeInTheDocument()
    expect(lastRfb().viewOnly).toBe(false)
  })

  it('hands back and closes 1000 when the Computer tab unmounts', async () => {
    const { unmount } = render(<Owner />)
    await connect()
    await take()
    unmount()
    await waitFor(() => expect(calls('display.lease.release')).toHaveLength(1))
    expect(calls('display.lease.release')[0]!.params).toEqual({ profile: 'scout', viewer_id: 'v1' })
    expect(FakeSocket.instances[0]!.closedWith).toContain(1000)
  })

  it('closes 1000 on unmount without a release when we hold nothing', async () => {
    const { unmount } = render(<Owner />)
    await connect()
    unmount()
    await waitFor(() => expect(FakeSocket.instances[0]!.closedWith).toContain(1000))
    expect(calls('display.lease.release')).toHaveLength(0)
  })

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
      const { unmount } = render(<Owner />)
      await connect()
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

  it('forwards a paste only while in control and caps it at 256 KiB', async () => {
    render(<Owner />)
    await connect()
    const host = lastRfb().target
    const paste = (text: string) => {
      const event = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown }
      event.clipboardData = { getData: () => text }
      host.dispatchEvent(event)
      return event
    }
    paste('watching')
    expect(lastRfb().pastes).toEqual([])
    await take()
    expect(paste('hello').defaultPrevented).toBe(true)
    expect(lastRfb().pastes).toEqual(['hello'])
    paste('x'.repeat(262_144))
    expect(lastRfb().pastes).toHaveLength(2)
    expect(paste('x'.repeat(262_145)).defaultPrevented).toBe(false)
    expect(lastRfb().pastes).toHaveLength(2)
  })

  it('shows both Take control and Give control back when someone else holds it', async () => {
    lease = { holder: 'human', viewer_hash: 'someoneelse1', since: 2, epoch: 4 }
    render(<Owner />)
    await connect()
    expect(screen.getByText('Someone is in control')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Take control' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Give control back to Scout' }))
    await waitFor(() => expect(calls('display.lease.release')[0]!.params).toEqual({ profile: 'scout', force: true }))
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

  void live
})
