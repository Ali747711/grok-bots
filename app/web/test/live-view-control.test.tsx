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

describe('live view control', () => {
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
  it('keeps focus away from the canvas while watching so Tab and Escape reach the page', async () => {
    render(<Owner />)
    await connect()
    expect(lastRfb().focusOnClick).toBe(false)
    await take()
    expect(lastRfb().focusOnClick).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
    await waitFor(() => expect(screen.getByText('Bot is in control')).toBeInTheDocument())
    expect(lastRfb().focusOnClick).toBe(false)
    expect(lastRfb().blurs).toBeGreaterThan(0)
  })
  it('draws the you-are-in-control chip text in the readable destructive colour', async () => {
    render(<Owner />)
    await connect()
    await take()
    expect(screen.getByText("You're in control")).toHaveClass('text-destructive')
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
  it('shows the connecting skeleton on the first connect', async () => {
    client.handlers['display.observe'] = () => new Promise(() => undefined)
    render(<Owner />)
    await waitFor(() => expect(screen.getByRole('status', { name: 'Connecting to the screen' })).toBeInTheDocument())
    expect(screen.getByTestId('link')).toHaveTextContent('connecting')
  })
  it('disables Take control until the view is live', async () => {
    render(<Owner />)
    await waitRfb(1)
    expect(screen.getByRole('button', { name: 'Take control' })).toBeDisabled()
    act(() => lastRfb().emit('connect'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take control' })).toBeEnabled())
  })
  it('announces who is in control as a polite status', async () => {
    render(<Owner />)
    await connect()
    const chip = screen.getByText('Bot is in control')
    expect(chip).toHaveAttribute('role', 'status')
    expect(chip).toHaveAttribute('aria-live', 'polite')
  })
  it('still hands back when the view unmounted in an earlier commit and then the owner leaves', async () => {
    const { rerender, unmount } = render(<Owner ask />)
    await connect()
    await take()
    rerender(<Owner ask={false} />)
    await act(async () => { await Promise.resolve() })
    expect(calls('display.lease.release')).toHaveLength(0)
    unmount()
    await waitFor(() => expect(calls('display.lease.release')).toHaveLength(1))
  })
})

describe('live view paste keys', () => {
  const clipboard = (readText: () => Promise<string>) => Object.defineProperty(navigator, 'clipboard', { value: { readText }, configurable: true })
  const ctrlV = () => new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true })
  afterEach(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }) })

  it('on Ctrl+V while in control reads the clipboard, pastes it, then sends v', async () => {
    const readText = vi.fn().mockResolvedValue('from clipboard')
    clipboard(readText)
    render(<Owner />)
    await connect()
    await take()
    const host = lastRfb().target
    const canvas = document.createElement('canvas')
    const reached = vi.fn()
    canvas.addEventListener('keydown', reached)
    host.appendChild(canvas)
    const event = ctrlV()
    canvas.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(reached).not.toHaveBeenCalled() // capture on the host runs first and stops noVNC seeing it
    await waitFor(() => expect(lastRfb().log).toEqual(['paste:14', 'key:65507:ControlLeft:down', 'key:118:KeyV', 'key:65507:ControlLeft:up']))
    expect(readText).toHaveBeenCalledTimes(1)
  })

  it('releases the remapped Cmd (Alt_L) first, then sends the Ctrl chord, for Cmd+V', async () => {
    clipboard(() => Promise.resolve('abc'))
    render(<Owner />)
    await connect()
    await take()
    lastRfb().target.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', metaKey: true, bubbles: true, cancelable: true }))
    await waitFor(() => expect(lastRfb().log).toEqual(['paste:3', 'key:65513:MetaLeft:up', 'key:65507:ControlLeft:down', 'key:118:KeyV', 'key:65507:ControlLeft:up']))
  })

  it('keeps Shift in the chord for Ctrl+Shift+V (the terminal paste shortcut)', async () => {
    clipboard(() => Promise.resolve('abc'))
    render(<Owner />)
    await connect()
    await take()
    lastRfb().target.dispatchEvent(new KeyboardEvent('keydown', { key: 'V', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }))
    await waitFor(() => expect(lastRfb().log).toEqual(['paste:3', 'key:65507:ControlLeft:down', 'key:65505:ShiftLeft:down', 'key:86:KeyV', 'key:65505:ShiftLeft:up', 'key:65507:ControlLeft:up']))
  })

  it('still pastes on a non-Latin layout (key is not "v" but the code is KeyV)', async () => {
    clipboard(() => Promise.resolve('abc'))
    render(<Owner />)
    await connect()
    await take()
    lastRfb().target.dispatchEvent(new KeyboardEvent('keydown', { key: 'м', code: 'KeyV', ctrlKey: true, bubbles: true, cancelable: true }))
    await waitFor(() => expect(lastRfb().log).toContain('key:118:KeyV'))
  })

  it('swallows a held-down Ctrl+V without pasting again', async () => {
    const readText = vi.fn().mockResolvedValue('abc')
    clipboard(readText)
    render(<Owner />)
    await connect()
    await take()
    const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, repeat: true, bubbles: true, cancelable: true })
    lastRfb().target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(readText).not.toHaveBeenCalled()
  })

  it('ignores Ctrl+V when not in control', async () => {
    const readText = vi.fn().mockResolvedValue('x')
    clipboard(readText)
    render(<Owner />)
    await connect()
    const event = ctrlV()
    lastRfb().target.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(readText).not.toHaveBeenCalled()
  })

  it('shows a notice when clipboard permission is denied', async () => {
    clipboard(() => Promise.reject(new Error('denied')))
    render(<Owner />)
    await connect()
    await take()
    lastRfb().target.dispatchEvent(ctrlV())
    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent('Allow clipboard access to paste into the screen'))
    expect(lastRfb().log).toEqual([])
  })

  it('sends nothing and shows a notice when the text is over 256 KiB', async () => {
    clipboard(() => Promise.resolve('x'.repeat(262_145)))
    render(<Owner />)
    await connect()
    await take()
    lastRfb().target.dispatchEvent(ctrlV())
    await waitFor(() => expect(screen.getByTestId('notice')).toHaveTextContent('256 KiB'))
    expect(lastRfb().log).toEqual([])
  })
})
