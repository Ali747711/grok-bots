import { createHash } from 'node:crypto'

import { MemoryRouter } from 'react-router-dom'

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ChatItem, WorkStep } from '@/chat/types'

import { FakeClient } from './fake-client'
import { bot } from './fixtures'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))
// The open chat's items, which the Now strip and Recent actions read; only this bot's chat is ever handed out.
const chat = vi.hoisted(() => ({ items: [] as ChatItem[] }))
vi.mock('@/features/chat/chat-session-context', () => ({ useBotChat: (name: string) => ({ items: name === 'scout' ? chat.items : [] }) }))

const rfbs = vi.hoisted(() => ({ list: [] as { disconnects: number }[] }))
vi.mock('@novnc/novnc', () => {
  class FakeRfb {
    viewOnly = true
    disconnects = 0
    private listeners = new Map<string, (() => void)[]>()
    constructor(public target: HTMLElement) {
      rfbs.list.push(this)
      void Promise.resolve().then(() => { for (const fn of this.listeners.get('connect') ?? []) fn() })
    }
    addEventListener(type: string, fn: () => void) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]) }
    disconnect() { this.disconnects += 1 }
    focus() {}
    blur() {}
    clipboardPasteFrom() {}
    sendKey() {}
  }
  return { default: FakeRfb }
})

class FakeSocket {
  static instances: FakeSocket[] = []
  binaryType = ''
  closedWith: (number | undefined)[] = []
  constructor(public url: string) { FakeSocket.instances.push(this) }
  addEventListener() {}
  close(code?: number) { this.closedWith.push(code) }
}

import { pageDialBudget } from '@/features/computer/dial-budget'
import { SidePanel } from '@/features/side-panel/SidePanel'
import { liveControlHeld } from '@/lib/live-control'

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 12)
let lease: { holder: string; viewer_hash: string | null; since: number; epoch: number }
let overrides: Record<string, unknown>
const fetchMock = vi.fn()
const scout = bot({ name: 'scout', title: 'Scout' })

const status = () => ({
  profile: 'scout', supported: true, installed: true, missing: [], running: false, geometry: '1440x900', profile_key: '/h/scout', lease, ...overrides
})

beforeEach(() => {
  pageDialBudget.reset('scout') // the page-wide dial budget outlives a test
  FakeSocket.instances = []
  rfbs.list = []
  client.calls = []
  client.setState('open')
  chat.items = []
  lease = { holder: 'agent', viewer_hash: null, since: 1, epoch: 1 }
  overrides = {}
  client.handlers = {
    'display.status': () => status(),
    'display.observe': () => ({ ...status(), viewer_id: 'v1', ticket: 'tkt-1' }),
    'display.lease.acquire': p => ({ lease: (lease = { holder: 'human', viewer_hash: hashOf(p.viewer_id as string), since: 2, epoch: lease.epoch + 1 }) }),
    'display.lease.release': () => ({ lease: (lease = { holder: 'agent', viewer_hash: null, since: 3, epoch: lease.epoch + 1 }) }),
    'display.stop': () => ({ ...status(), running: false, stopped: true })
  }
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/screen/config')) return new Response(JSON.stringify({ useScreen: init?.method === 'PUT', idleStopMinutes: 15 }), { status: 200 })
    if (url.endsWith('/screen/start')) return new Response(JSON.stringify({ ...status(), running: true }), { status: 200 })
    return new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('WebSocket', FakeSocket)
})
afterEach(() => vi.unstubAllGlobals())

const calls = (m: string) => client.callsOf(m)
const noop = () => undefined
/** The side panel as the app mounts it: the header (tabs, link chip, Close) and the open tab's body. */
const panel = (b = scout, tab: 'computer' | 'routines' = 'computer') => <MemoryRouter><SidePanel bot={b} tab={tab} onTab={noop} onClose={noop} /></MemoryRouter>
const show = (b = scout) => render(panel(b))
const live = async () => { overrides = { running: true }; const view = show(); await waitFor(() => expect(rfbs.list).toHaveLength(1)); return view }
const chip = () => document.querySelector('[data-slot="side-chip"]') as HTMLElement
const takeControl = async () => {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Take control' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
  await screen.findByText("You're in control")
}
const step = (id: string, over: Partial<WorkStep> = {}): WorkStep => ({ id, name: 'terminal', summary: `run ${id}`, running: false, ...over })

describe('ScreenTab', () => {
  it('shows each screen state and starts the screen from the off state', async () => {
    overrides = { installed: false }
    const { unmount } = show()
    expect(await screen.findByText(/hermes computer-use screen install/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: /install/i })).toBeNull()
    expect(chip()).toHaveTextContent('Off')
    unmount()

    overrides = {}
    const off = show()
    expect(await screen.findByText("Scout's screen is off.")).toBeInTheDocument()
    expect(screen.queryByText(/Files and open apps are saved/)).toBeNull()
    expect(chip()).toHaveTextContent('Off')
    fireEvent.click(await screen.findByRole('button', { name: 'Start screen' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/crew/bots/scout/screen/start' && c[1].method === 'POST')).toBe(true))
    expect(calls('display.start')).toHaveLength(0)
    off.unmount()

    overrides = { blocker: 'Not enough free memory for a desktop: 900 MB available' }
    const low = show()
    expect(await screen.findByText('Not enough free memory for a desktop: 900 MB available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start screen' })).toBeDisabled()
    const reads = calls('display.status').length
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(calls('display.status').length).toBeGreaterThan(reads))
    low.unmount()

    client.handlers['display.status'] = () => new Promise(() => undefined)
    const loading = show()
    expect(await screen.findByRole('status', { name: 'Loading the screen' })).toBeInTheDocument()
    expect(chip()).toHaveTextContent('Connecting…')
    loading.unmount()

    overrides = {}
    client.handlers['display.status'] = () => status()
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/screen/start')
      ? new Response(JSON.stringify({ error: 'hermes_error', message: 'launcher exited' }), { status: 502 })
      : new Response(JSON.stringify({ useScreen: false, idleStopMinutes: 15 }), { status: 200 }))
    const failed = show()
    fireEvent.click(await screen.findByRole('button', { name: 'Start screen' }))
    expect(await screen.findByText('launcher exited')).toBeInTheDocument()
    const again = screen.getByRole('button', { name: 'Try again' })
    fetchMock.mockClear()
    fireEvent.click(again)
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/crew/bots/scout/screen/start')).toBe(true))
    failed.unmount()

    await live()
    expect(screen.getByRole('button', { name: 'Stop screen' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Expand the screen' })).toBeInTheDocument()
    expect(screen.getByText("Taking control pauses the bot's screen tools. It doesn't lock the rest of its computer.")).toBeInTheDocument()
    await waitFor(() => expect(chip()).toHaveTextContent('Live'))
    expect(screen.getByTestId('live-view')).not.toHaveClass('ring-watermelon')
  })

  it("shows You're in control once, in the header chip", async () => {
    await live()
    await takeControl()
    const said = screen.getAllByText("You're in control")
    expect(said).toHaveLength(1)
    expect(chip()).toContainElement(said[0]!)
    expect(within(chip()).getByRole('status')).toHaveAttribute('aria-live', 'polite')
    // The accent is the dot and the frame, never the text.
    expect(chip().querySelector('[data-accent="true"]')).toHaveClass('bg-watermelon')
    expect(said[0]).not.toHaveClass('text-watermelon')
    expect(screen.getByTestId('live-view')).toHaveClass('ring-2', 'ring-watermelon')
    fireEvent.click(screen.getByRole('button', { name: 'Hand back' }))
    await waitFor(() => expect(chip()).toHaveTextContent('Live'))
    expect(screen.queryByText("You're in control")).toBeNull()
    expect(screen.getByTestId('live-view')).not.toHaveClass('ring-watermelon')
  })

  it('shows the running step in the Now strip and Idle otherwise', async () => {
    const now = () => document.querySelector('[data-slot="now-strip"] [aria-live="polite"] .sr-only')
    const { rerender } = show()
    await screen.findByRole('button', { name: 'Start screen' })
    expect(now()).toHaveTextContent('Idle')
    chat.items = [{ kind: 'work', id: 'w1', steps: [step('a'), step('b', { running: true, summary: 'Opening example.com' })] }]
    rerender(panel())
    expect(now()).toHaveTextContent('Opening example.com')
    chat.items = [{ kind: 'work', id: 'w1', steps: [step('a'), step('b', { summary: 'Opening example.com' })] }]
    rerender(panel())
    expect(now()).toHaveTextContent('Idle')
    expect(screen.queryByRole('meter')).toBeNull() // no CPU or memory meters
  })

  it('lists recent actions newest first with a time, the tool, the summary and Failed', async () => {
    const { rerender } = show()
    const log = await screen.findByRole('region', { name: "Scout's recent actions" })
    expect(within(log).getByRole('heading', { name: 'Recent actions' })).toBeInTheDocument()
    expect(within(log).getByText('No actions yet.')).toBeInTheDocument()
    chat.items = [
      { kind: 'work', id: 'w1', steps: [step('a', { at: new Date(2026, 0, 5, 9, 7).getTime() }), step('b', { name: 'browser_navigate', summary: 'example.com', isError: true })] }
    ]
    rerender(panel())
    const rows = within(log).getAllByRole('listitem')
    expect(rows.map(r => r.textContent)).toEqual(['browser_navigateexample.comFailed', '09:07terminalrun a'])
    expect(within(rows[0]!).getByText('Failed')).not.toHaveClass('text-destructive') // PF31: a dot, not red text on the well
    expect(rows[0]!.querySelector('time')).toBeEmptyDOMElement()
    expect(within(log).queryByText('No actions yet.')).toBeNull()
  })

  it('disables Stop while a human holds control and confirms before stopping', async () => {
    await live()
    expect(await screen.findByRole('button', { name: 'Stop screen' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Stop screen' }))
    expect(await screen.findByText("Stop Scout's screen? Its windows close.")).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByText("Stop Scout's screen? Its windows close.")).toBeNull())
    expect(calls('display.stop')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Stop screen' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }))
    await waitFor(() => expect(calls('display.stop')).toHaveLength(1))
    expect(calls('display.stop')[0]!.params).toEqual({ profile: 'scout' })
  })

  it('keeps Stop disabled and says who holds control while someone else does', async () => {
    lease = { holder: 'human', viewer_hash: 'someoneelse1', since: 2, epoch: 4 }
    await live()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop screen' })).toBeDisabled())
    expect(screen.getAllByText('Someone is in control')).toHaveLength(2) // the chip and Stop's helper
  })

  it('shows the install command Hermes reports', async () => {
    overrides = { installed: false, install_command: 'sudo apt install xvnc-thing' }
    show()
    expect(await screen.findByText('sudo apt install xvnc-thing')).toBeInTheDocument()
  })

  it('re-reads instead of starting when no status loaded, and offers no retry when unsupported', async () => {
    client.handlers['display.status'] = () => { throw new Error('gateway down') }
    const first = show()
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls('display.status').length).toBeGreaterThan(1))
    expect(fetchMock.mock.calls.some(c => c[0] === '/crew/bots/scout/screen/start')).toBe(false)
    first.unmount()

    client.handlers['display.status'] = () => ({ ...status(), supported: false })
    show()
    await screen.findByText(/can't run a bot screen/)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('never hits Reconnect over three panel and Expand round trips', async () => {
    await live()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take control' })).toBeEnabled())
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Expand the screen' }))
      const dialog = await screen.findByRole('dialog')
      await waitFor(() => expect(within(dialog).getByTestId('live-view')).toBeInTheDocument())
      await waitFor(() => expect(rfbs.list).toHaveLength(1 + 2 * i + 1))
      fireEvent.click(within(dialog).getByRole('button', { name: 'Close expanded view' }))
      await waitFor(() => expect(rfbs.list).toHaveLength(1 + 2 * i + 2))
    }
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull()
  })

  it('keeps Stop disabled while you hold control', async () => {
    await live()
    await takeControl()
    expect(screen.getByRole('button', { name: 'Stop screen' })).toBeDisabled()
    expect(screen.getByText('Hand back first')).toBeInTheDocument()
  })

  it('links the off state to Screen settings on the profile, and holds no use-screen switch', async () => {
    const first = show()
    await screen.findByRole('button', { name: 'Start screen' })
    expect(screen.getByRole('link', { name: 'Screen settings' })).toHaveAttribute('href', '/bots/scout?panel=profile&tab=advanced')
    // The switch moved to the profile's Advanced tab: the panel never reads or writes the screen config.
    expect(screen.queryByRole('switch')).toBeNull()
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith('/screen/config'))).toBe(false)
    first.unmount()

    // A running screen has its controls instead; the link is for the off state.
    await live()
    expect(screen.queryByRole('link', { name: 'Screen settings' })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('moves the viewer to Expand and back without handing control back', async () => {
    await live()
    await takeControl()
    fireEvent.click(screen.getByRole('button', { name: 'Expand the screen' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(rfbs.list).toHaveLength(2))
    expect(within(dialog).queryByRole('button', { name: 'Close' })).toBeNull() // the view has its own collapse button
    expect(within(dialog).getByTestId('live-view')).toBeInTheDocument()
    // The shell hugs the screen: 12 px of padding keeps the 12 px screen corners concentric with the 24 px shell.
    expect(dialog).toHaveClass('rounded-3xl', 'bg-shell', 'p-3')
    expect(dialog).not.toHaveClass('p-6')
    expect(rfbs.list[0]!.disconnects).toBe(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close expanded view' }))
    await waitFor(() => expect(rfbs.list).toHaveLength(3))
    // The chip says "Connecting…" until the moved view is live again (R11), then names the holder.
    expect(await screen.findByText("You're in control")).toBeInTheDocument()
    expect(calls('display.lease.release')).toHaveLength(0)
    expect(FakeSocket.instances.some(w => w.closedWith.includes(1000))).toBe(false)
    expect(calls('display.observe').slice(1).every(c => c.params.viewer_id === 'v1')).toBe(true)
  })

  it('unmounts the viewer when switching to Routines', async () => {
    overrides = { running: true }
    const { rerender } = render(panel(scout, 'computer'))
    await takeControl()
    expect(liveControlHeld()).toBe(true)
    const tabs = screen.getByRole('tablist')
    rerender(panel(scout, 'routines'))
    // Gone with the tab: the viewer, its controls and the header chip. The header itself stays mounted.
    expect(screen.queryByTestId('live-view')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Hand back' })).toBeNull()
    expect(chip()).toBeEmptyDOMElement()
    expect(screen.getByRole('tablist')).toBe(tabs)
    // PF27: leaving hands control back and closes the pixel socket cleanly.
    await waitFor(() => expect(calls('display.lease.release')).toHaveLength(1))
    expect(FakeSocket.instances[0]!.closedWith).toContain(1000)
    expect(liveControlHeld()).toBe(false)
    expect(rfbs.list[0]!.disconnects).toBe(1)
  })

  it('hands control back and unmounts the viewer when the bot changes', async () => {
    overrides = { running: true }
    const { rerender } = render(panel(scout))
    await takeControl()
    client.handlers['display.status'] = p => ({ ...status(), running: false, profile: p.profile, profile_key: `/h/${String(p.profile)}` })
    rerender(panel(bot({ name: 'other', title: 'Other' })))
    await waitFor(() => expect(calls('display.lease.release')).toHaveLength(1))
    expect(calls('display.lease.release')[0]!.params).toMatchObject({ profile: 'scout' })
    expect(FakeSocket.instances[0]!.closedWith).toContain(1000)
    expect(liveControlHeld()).toBe(false)
    expect(await screen.findByText("Other's screen is off.")).toBeInTheDocument()
    expect(screen.queryByTestId('live-view')).toBeNull()
  })

  it('hands control back and closes 1000 when the side panel closes while the user holds control', async () => {
    overrides = { running: true }
    // What the shell does: the side slot is empty once the panel is closed.
    const el = (open: boolean) => <MemoryRouter>{open ? <SidePanel bot={scout} tab="computer" onTab={noop} onClose={noop} /> : null}</MemoryRouter>
    const { rerender } = render(el(true))
    await takeControl()
    expect(liveControlHeld()).toBe(true)
    expect(calls('display.lease.release')).toHaveLength(0)
    rerender(el(false))
    expect(screen.queryByTestId('live-view')).toBeNull()
    await waitFor(() => expect(calls('display.lease.release')).toHaveLength(1))
    expect(FakeSocket.instances[0]!.closedWith).toContain(1000)
    expect(liveControlHeld()).toBe(false)
  })
})
