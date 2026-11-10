import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { AppsDialog } from '@/features/apps/AppsDialog'

import { ComposioKeyRow } from '@/features/settings/ComposioKeyRow'

import { bot } from './fixtures'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const LIST = {
  apps: [
    { id: 'ca_1', toolkit: 'github', name: 'GitHub', status: 'connected' },
    { id: 'ca_2', toolkit: 'notion', name: 'Notion', status: 'pending' }
  ],
  usage: { github: ['dev', 'research'] }
}

type Route = (url: string, init?: RequestInit) => Promise<Response> | undefined
function stub(routes: Route) {
  const fn = vi.fn((url: string, init?: RequestInit) => routes(url, init) ?? json({}, 404))
  vi.stubGlobal('fetch', fn)
  return fn
}
const open = (onOpenChange = vi.fn(), bots: Parameters<typeof bot>[0][] = []) =>
  render(<AppsDialog open onOpenChange={onOpenChange} bots={bots.map(bot)} />)

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }))
afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  toast.success.mockClear()
})

const connectRoutes = (poll: () => Promise<Response>): Route => (url, init) => {
  if (url === '/crew/connectors/apps') return json({ apps: [], usage: {} })
  if (url.startsWith('/crew/connectors/toolkits')) return json({ toolkits: [{ slug: 'github', name: 'GitHub' }] })
  if (url === '/crew/connectors/connect' && init?.method === 'POST') return json({ redirectUrl: 'https://connect.composio.dev/x', connectionId: 'ca_9' })
  if (url === '/crew/connectors/connect/ca_9') return poll()
  return undefined
}

async function startConnect() {
  fireEvent.click(await screen.findByRole('button', { name: 'Connect an app' }))
  fireEvent.change(await screen.findByLabelText('Search apps'), { target: { value: 'git' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(350) })
  fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
}

describe('AppsDialog', () => {
  it('lists connected apps with a letter tile and their status', async () => {
    stub(url => (url === '/crew/connectors/apps' ? json(LIST) : undefined))
    open()
    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Apps your bots can use, through Composio.')).toBeInTheDocument()
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByText('Waiting for sign-in…')).toBeInTheDocument()
    expect(screen.getByText('G')).toHaveAttribute('aria-hidden', 'true')
  })

  it('says no apps yet', async () => {
    stub(url => (url === '/crew/connectors/apps' ? json({ apps: [], usage: {} }) : undefined))
    open()
    expect(await screen.findByText('No apps connected yet.')).toBeInTheDocument()
  })

  it('says there is no key and opens Settings from the link', async () => {
    stub(url => (url === '/crew/connectors/apps' ? json({ error: 'no_key' }, 409) : undefined))
    const seen = vi.fn()
    window.addEventListener('crew:open-dialog', e => seen((e as CustomEvent).detail))
    open()
    expect(await screen.findByText('No Composio key yet.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Set the key in Settings' }))
    expect(seen).toHaveBeenCalledWith('settings')
  })

  it('says the key was not accepted', async () => {
    stub(url => (url === '/crew/connectors/apps' ? json({ error: 'key_rejected' }, 409) : undefined))
    open()
    expect(await screen.findByText('Key not accepted')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set the key in Settings' })).toBeInTheDocument()
  })

  it("says Couldn't reach Composio", async () => {
    stub(url => (url === '/crew/connectors/apps' ? json({ error: 'composio_unavailable' }, 502) : undefined))
    open()
    expect(await screen.findByText("Couldn't reach Composio")).toBeInTheDocument()
  })

  it('searches, connects, opens the sign-in tab and shows the link while waiting', async () => {
    const win = vi.spyOn(window, 'open').mockReturnValue(null)
    const fn = stub(connectRoutes(() => json({ state: 'pending' })))
    open()
    await startConnect()
    await waitFor(() => expect(win).toHaveBeenCalledWith('https://connect.composio.dev/x', '_blank', 'noopener,noreferrer'))
    expect(fn.mock.calls.some(([u]) => u === '/crew/connectors/toolkits?search=git')).toBe(true)
    expect(await screen.findByText('Finish signing in to GitHub in the new tab.')).toBeInTheDocument()
    const link = screen.getByRole('link', { name: 'Open the sign-in page' })
    expect(link).toHaveAttribute('href', 'https://connect.composio.dev/x')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    expect(link).toHaveAttribute('target', '_blank')
    win.mockRestore()
  })

  it('shows Connected after polling and stops polling', async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    let polls = 0
    const fn = stub(connectRoutes(() => { polls += 1; return json({ state: polls < 2 ? 'pending' : 'connected' }) }))
    open()
    await startConnect()
    await screen.findByText('Finish signing in to GitHub in the new tab.')
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('GitHub connected'))
    const count = fn.mock.calls.filter(([u]) => u === '/crew/connectors/connect/ca_9').length
    await act(async () => { await vi.advanceTimersByTimeAsync(9000) })
    expect(fn.mock.calls.filter(([u]) => u === '/crew/connectors/connect/ca_9').length).toBe(count)
  })

  it("shows Sign-in didn't finish after 10 minutes", async () => {
    vi.spyOn(window, 'open').mockReturnValue(null)
    stub(connectRoutes(() => json({ state: 'pending' })))
    open()
    await startConnect()
    await screen.findByText('Finish signing in to GitHub in the new tab.')
    await act(async () => { await vi.advanceTimersByTimeAsync(601_000) })
    expect(await screen.findByText("Sign-in didn't finish")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('disconnect names the bots that use the app and says access is revoked', async () => {
    const fn = stub((url, init) => {
      if (url === '/crew/connectors/apps' && init?.method === 'DELETE') return undefined
      if (url === '/crew/connectors/apps') return json(LIST)
      if (url === '/crew/connectors/apps/ca_1') return Promise.resolve(new Response(null, { status: 204 }))
      return undefined
    })
    open(vi.fn(), [{ name: 'dev', title: 'Scout Bot' }])
    await screen.findByText('GitHub')
    fireEvent.click(screen.getAllByRole('button', { name: /Disconnect/ })[0]!)
    expect(await screen.findByText('Disconnect GitHub?')).toBeInTheDocument()
    // 'research' is not in the roster, so its name is the fallback.
    expect(screen.getByText("Scout Bot, research use GitHub. Disconnecting removes it from them and revokes Crew's access to your GitHub account.")).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Disconnect' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('GitHub disconnected'))
    expect(fn.mock.calls.some(([u, i]) => u === '/crew/connectors/apps/ca_1' && i?.method === 'DELETE')).toBe(true)
  })

  it('shows Loading apps… before the list resolves', async () => {
    let release: (r: Response) => void = () => undefined
    stub(url => (url === '/crew/connectors/apps' ? new Promise<Response>(r => { release = r }) : undefined))
    open()
    expect(screen.getByText('Loading apps…')).toBeInTheDocument()
    await act(async () => { release(new Response(JSON.stringify(LIST))) })
    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.queryByText('Loading apps…')).toBeNull()
  })

  it('closes Apps before it asks for Settings', async () => {
    stub(url => (url === '/crew/connectors/apps' ? json({ error: 'no_key' }, 409) : undefined))
    const order: string[] = []
    window.addEventListener('crew:open-dialog', () => order.push('open'), { once: true })
    const onOpenChange = vi.fn((o: boolean) => order.push(`apps:${o}`))
    open(onOpenChange)
    fireEvent.click(await screen.findByRole('button', { name: 'Set the key in Settings' }))
    expect(order).toEqual(['apps:false', 'open'])
  })

  it('re-reads and lists the apps after a key is saved from Settings', async () => {
    let saved = false
    stub((url, init) => {
      if (url === '/crew/connectors/apps') return saved ? json(LIST) : json({ error: 'no_key' }, 409)
      if (url === '/crew/connectors/key' && init?.method === 'PUT') { saved = true; return json({ configured: true }) }
      if (url === '/crew/connectors/key') return json({ configured: saved })
      return undefined
    })
    render(<><AppsDialog open onOpenChange={vi.fn()} bots={[]} /><ComposioKeyRow /></>)
    expect(await screen.findByText('No Composio key yet.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Composio API key'), { target: { value: 'ak_test_key_123' } })
    // The modal Apps dialog hides the row beside it from the accessibility tree.
    fireEvent.click(screen.getByRole('button', { name: 'Save key', hidden: true }))
    expect(await screen.findByText('GitHub')).toBeInTheDocument()
    expect(screen.queryByText('No Composio key yet.')).toBeNull()
  })

  it('names no bots when another account of the app is still connected', async () => {
    const list = { apps: [
      { id: 'ca_1', toolkit: 'github', name: 'GitHub', status: 'connected' },
      { id: 'ca_3', toolkit: 'github', name: 'GitHub', status: 'failed' }
    ], usage: { github: ['dev'] } }
    stub(url => (url === '/crew/connectors/apps' ? json(list) : undefined))
    open(vi.fn(), [{ name: 'dev', title: 'Scout Bot' }])
    await screen.findAllByText('GitHub')
    fireEvent.click(screen.getAllByRole('button', { name: /Disconnect/ })[1]!)
    expect(await screen.findByText("Disconnecting revokes Crew's access to your GitHub account.")).toBeInTheDocument()
  })

  it("says Crew can't connect an app without managed sign-in", async () => {
    stub((url, init) => {
      if (url === '/crew/connectors/apps') return json({ apps: [], usage: {} })
      if (url.startsWith('/crew/connectors/toolkits')) return json({ toolkits: [{ slug: 'weird', name: 'Weird' }] })
      if (url === '/crew/connectors/connect' && init?.method === 'POST') return json({ error: 'app_unsupported' }, 409)
      return undefined
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Connect an app' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(350) })
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))
    expect(await screen.findByText("Crew can't connect Weird yet.")).toBeInTheDocument()
  })
})
