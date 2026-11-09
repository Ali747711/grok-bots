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

function Owner({ where = 'panel', ask = true }: { where?: 'panel' | 'expand'; ask?: boolean }) {
  const { screen: s, live } = useComputer('scout', { budget })
  return (
    <>
      <span data-testid="link">{live.link}</span>
      <span data-testid="error">{live.error ?? ''}</span>
      <span data-testid="notice">{live.notice ?? ''}</span>
      <div data-testid="panel">{ask && where === 'panel' && <LiveView live={live} inControl={s.view.control === 'you'} />}</div>
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


describe('live view lifecycle (final wave)', () => {
  it('releases a lease acquired by a Take control that was in flight when the owner left', async () => {
    const { unmount } = render(<Owner />)
    await connect()
    let finish!: () => void
    client.handlers['display.lease.acquire'] = p => new Promise(resolve => {
      finish = () => {
        lease = { holder: 'human', viewer_hash: hashOf(p.viewer_id as string), since: 5, epoch: lease.epoch + 1 }
        resolve({ lease })
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await waitFor(() => expect(calls('display.lease.acquire')).toHaveLength(1))
    unmount()
    await act(async () => { finish(); await new Promise(r => setTimeout(r, 30)) })
    expect(calls('display.lease.release').length).toBeGreaterThan(0)
    expect(lease.holder).toBe('agent')
  })

  it('also releases the deferred acquire that was in flight when the owner left', async () => {
    const { unmount } = render(<Owner />)
    await connect()
    act(() => client.setState('closed'))
    act(() => client.setState('open'))
    forceNewId = true
    let finish!: () => void
    client.handlers['display.lease.acquire'] = p => new Promise(resolve => {
      finish = () => {
        lease = { holder: 'human', viewer_hash: hashOf(p.viewer_id as string), since: 5, epoch: lease.epoch + 1 }
        resolve({ lease })
      }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await waitFor(() => expect(calls('display.lease.acquire')).toHaveLength(1))
    unmount()
    await act(async () => { finish(); await new Promise(r => setTimeout(r, 30)) })
    expect(lease.holder).toBe('agent')
  })

  it('does not run out of dials when the tab is opened and left three times, then opened a fourth time', async () => {
    budget = createDialBudget({ max: 3, windowMs: 10_000, mountDelayMs: 0 })
    for (let n = 1; n <= 3; n++) {
      const view = render(<Owner />)
      await connect(n)
      view.unmount()
      await new Promise(r => setTimeout(r, 5))
    }
    render(<Owner />)
    await waitRfb(4)
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull()
  })

  it('offers Reconnect instead of a blank view when a clean close leaves a running screen idle', async () => {
    render(<Owner />)
    await connect()
    client.handlers['display.status'] = () => { throw new Error('gateway hiccup') }
    act(() => FakeSocket.instances[0]!.serverClose(1000))
    const button = await screen.findByRole('button', { name: 'Reconnect' })
    expect(screen.getByTestId('link')).toHaveTextContent('idle')
    script()
    fireEvent.click(button)
    await waitRfb(2)
  })

  it('says "Reconnecting, you still have control" during a redial while we hold control, and not otherwise', async () => {
    render(<Owner />)
    await connect()
    await take()
    client.handlers['display.observe'] = () => new Promise(() => undefined)
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    expect(await screen.findByRole('status', { name: 'Reconnecting, you still have control' })).toBeInTheDocument()
  })

  it('says "Reconnecting to the screen" when we are only watching', async () => {
    render(<Owner />)
    await connect()
    client.handlers['display.observe'] = () => new Promise(() => undefined)
    act(() => FakeSocket.instances[0]!.serverClose(1006))
    expect(await screen.findByRole('status', { name: 'Reconnecting to the screen' })).toBeInTheDocument()
  })
})
