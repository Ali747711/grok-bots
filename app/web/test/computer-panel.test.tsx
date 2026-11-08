import { createHash } from 'node:crypto'

import { MemoryRouter } from 'react-router-dom'

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeClient } from './fake-client'
import { bot } from './fixtures'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))

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
import { ComputerPanel } from '@/features/computer/ComputerPanel'
import { BotPanel } from '@/features/panel/BotPanel'

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
const live = async () => { overrides = { running: true }; const view = render(<ComputerPanel bot={scout} />); await waitFor(() => expect(rfbs.list).toHaveLength(1)); return view }

describe('ComputerPanel', () => {
  it('shows the right action for each screen state', async () => {
    overrides = { installed: false }
    const { unmount } = render(<ComputerPanel bot={scout} />)
    expect(await screen.findByText(/hermes computer-use screen install/)).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: /install/i })).toBeNull()
    unmount()

    overrides = {}
    const off = render(<ComputerPanel bot={scout} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start screen' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/crew/bots/scout/screen/start' && c[1].method === 'POST')).toBe(true))
    expect(calls('display.start')).toHaveLength(0)
    off.unmount()

    overrides = { blocker: 'Not enough free memory for a desktop: 900 MB available' }
    const low = render(<ComputerPanel bot={scout} />)
    expect(await screen.findByText('Not enough free memory for a desktop: 900 MB available')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start screen' })).toBeDisabled()
    const reads = calls('display.status').length
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    await waitFor(() => expect(calls('display.status').length).toBeGreaterThan(reads))
    low.unmount()

    client.handlers['display.status'] = () => new Promise(() => undefined)
    const loading = render(<ComputerPanel bot={scout} />)
    expect(await screen.findByRole('status', { name: 'Loading the screen' })).toBeInTheDocument()
    loading.unmount()

    overrides = {}
    client.handlers['display.status'] = () => status()
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/screen/start')
      ? new Response(JSON.stringify({ error: 'hermes_error', message: 'launcher exited' }), { status: 502 })
      : new Response(JSON.stringify({ useScreen: false, idleStopMinutes: 15 }), { status: 200 }))
    const failed = render(<ComputerPanel bot={scout} />)
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
    expect(screen.getByText(/tools/)).toBeInTheDocument()
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
    render(<ComputerPanel bot={scout} />)
    expect(await screen.findByText('sudo apt install xvnc-thing')).toBeInTheDocument()
  })

  it('re-reads instead of starting when no status loaded, and offers no retry when unsupported', async () => {
    client.handlers['display.status'] = () => { throw new Error('gateway down') }
    const first = render(<ComputerPanel bot={scout} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(calls('display.status').length).toBeGreaterThan(1))
    expect(fetchMock.mock.calls.some(c => c[0] === '/crew/bots/scout/screen/start')).toBe(false)
    first.unmount()

    client.handlers['display.status'] = () => ({ ...status(), supported: false })
    render(<ComputerPanel bot={scout} />)
    await screen.findByText(/can't run a bot screen/)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('shows the read error when the use-screen setting cannot be loaded', async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith('/screen/config') ? new Response(JSON.stringify({ error: 'hermes_error', message: 'config unreadable' }), { status: 502 }) : new Response('{}', { status: 404 }))
    render(<ComputerPanel bot={scout} />)
    expect(await screen.findByText('config unreadable')).toBeInTheDocument()
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
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take control' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await screen.findByText("You're in control")
    expect(screen.getByRole('button', { name: 'Stop screen' })).toBeDisabled()
    expect(screen.getByText('Hand back first')).toBeInTheDocument()
  })

  it('hides the use-screen switch for the primary bot and saves both keys for others', async () => {
    const primary = render(<ComputerPanel bot={bot({ name: 'default', title: 'Hermes', isPrimary: true })} />)
    await screen.findByRole('button', { name: 'Start screen' })
    expect(screen.queryByRole('switch')).toBeNull()
    primary.unmount()

    render(<ComputerPanel bot={scout} />)
    const toggle = await screen.findByRole('switch', { name: 'Let Scout use its screen' })
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(/next time Scout opens its browser/)).toBeInTheDocument()
    fireEvent.click(toggle)
    await waitFor(() => expect(fetchMock.mock.calls.some(c => c[0] === '/crew/bots/scout/screen/config' && c[1].method === 'PUT')).toBe(true))
    const put = fetchMock.mock.calls.find(c => c[1]?.method === 'PUT')!
    expect(JSON.parse(put[1].body)).toEqual({ useScreen: true })
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Let Scout use its screen' })).toBeChecked())
  })

  it('moves the viewer to Expand and back without handing control back', async () => {
    await live()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take control' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await screen.findByText("You're in control")
    fireEvent.click(screen.getByRole('button', { name: 'Expand the screen' }))
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(rfbs.list).toHaveLength(2))
    expect(within(dialog).getByTestId('live-view')).toBeInTheDocument()
    expect(rfbs.list[0]!.disconnects).toBe(1)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close expanded view' }))
    await waitFor(() => expect(rfbs.list).toHaveLength(3))
    expect(screen.getByText("You're in control")).toBeInTheDocument()
    expect(calls('display.lease.release')).toHaveLength(0)
    expect(FakeSocket.instances.some(w => w.closedWith.includes(1000))).toBe(false)
    expect(calls('display.observe').slice(1).every(c => c.params.viewer_id === 'v1')).toBe(true)
  })

  it('hands back and closes 1000 when the Computer tab is left', async () => {
    overrides = { running: true }
    const el = (tab: 'computer' | 'routines') => <MemoryRouter><BotPanel bot={scout} tab={tab} /></MemoryRouter>
    const { rerender } = render(el('computer'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Take control' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Take control' }))
    await screen.findByText("You're in control")
    rerender(el('routines'))
    await waitFor(() => expect(calls('display.lease.release')).toHaveLength(1))
    expect(FakeSocket.instances[0]!.closedWith).toContain(1000)
  })
})
