import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SIDE_PANEL_KEY } from '@/app/side-panel-memory'
import { setLiveControlHeld } from '@/lib/live-control'
import type { CrewState } from '@/state/types'

import { FakeClient } from './fake-client'
import { bot, crewState, group, gm } from './fixtures'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))
const hook = vi.hoisted(() => ({ value: { state: null as CrewState | null, connected: true } }))
vi.mock('@/state/use-crew-state', () => ({ useCrewState: () => hook.value }))
// The real screen needs a display; this one only records that it mounted and unmounted.
const screenLog = vi.hoisted(() => ({ events: [] as string[] }))
vi.mock('@/features/computer/ComputerPanel', () => ({
  ComputerPanel: ({ bot: b }: { bot: { name: string } }) => {
    useEffect(() => {
      screenLog.events.push(`mount:${b.name}`)
      return () => { screenLog.events.push(`unmount:${b.name}`) }
    }, [b.name])
    return <div data-testid="screen-body" />
  }
}))

const { default: App } = await import('@/App')

const detail = (name: string) => ({ name, isPrimary: false, title: name === 'researcher' ? 'Researcher' : 'Dev', look: { shape: null, color: null, imageKind: null }, avatar: null, hidden: false, description: 'd', soul: 's', model: null, metaRevision: 1 })
const withGroup = () => crewState({ bots: [bot({ name: 'dev', title: 'Dev' })], groups: { available: true, seatable: ['dev'], rooms: [group({ id: 'r1', name: 'Launch', members: [gm('dev')] })] } })

beforeEach(() => {
  window.localStorage.clear()
  screenLog.events = []
  client.calls = []
  // Every bot already has its chat, so opening one is a `session.resume`.
  hook.value = { state: crewState({ bots: crewState().bots.map(b => ({ ...b, sessionId: `tip-${b.name}` })) }), connected: true }
  client.handlers = {
    'session.resume': p => ({ session_id: `live-${String(p.profile)}`, execution_generation: 1, running: false }),
    'prompt.submit': () => ({ status: 'started' })
  }
  vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(
    /^\/crew\/bots\/[^/]+$/.test(url) ? detail(url.slice('/crew/bots/'.length)) : { messages: [] }
  ), { status: 200 }))))
})
afterEach(() => {
  setLiveControlHeld(false)
  vi.unstubAllGlobals()
})

function Where() {
  const { pathname, search } = useLocation()
  return <span data-testid="where">{pathname + search}</span>
}
const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>)
const where = () => screen.getByTestId('where').textContent
const panel = () => screen.queryByRole('region', { name: 'Panel' })
const remembered = () => window.localStorage.getItem(SIDE_PANEL_KEY)
const message = () => screen.getByRole('textbox', { name: 'Message' })
const row = (name: string) => document.querySelector<HTMLElement>(`[data-bot="${name}"]`)!
const press = (init: KeyboardEventInit, target: Element = document.body) => fireEvent.keyDown(target, init)
const toggleSide = (target?: Element) => press({ key: '\\', ctrlKey: true }, target)

describe('App routes', () => {
  it('redirects / to the primary bot chat', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { name: 'Hermes' })).toBeInTheDocument()
  })

  it('shows the chat for /bots/:name', async () => {
    renderAt('/bots/dev')
    expect(await screen.findByRole('heading', { name: 'Dev' })).toBeInTheDocument()
  })

  it('says so for an unknown bot once the grace period has passed', () => {
    vi.useFakeTimers()
    renderAt('/bots/nobody')
    act(() => { vi.advanceTimersByTime(3100) })
    expect(screen.getByText('Bot not found')).toBeInTheDocument()
    vi.useRealTimers()
  })

  it('shows the group for /groups/:id', async () => {
    hook.value = { state: withGroup(), connected: true }
    renderAt('/groups/r1')
    expect(await screen.findByRole('heading', { name: 'Launch' })).toBeInTheDocument()
  })

  it('opens the group panel for ?panel=group', async () => {
    hook.value = { state: withGroup(), connected: true }
    renderAt('/groups/r1?panel=group')
    expect(await screen.findByText('Group details')).toBeInTheDocument()
    expect(within(panel()!).getByRole('button', { name: 'Delete group' })).toBeInTheDocument()
  })

  it('falls back to / for an unknown group after the grace period', async () => {
    vi.useFakeTimers()
    renderAt('/groups/nope')
    expect(screen.getByRole('status')).toBeInTheDocument()
    act(() => { vi.advanceTimersByTime(3100) })
    vi.useRealTimers()
    expect(await screen.findByRole('heading', { name: 'Hermes' })).toBeInTheDocument()
  })

  it('shows the Needs you page', () => {
    renderAt('/needs-you')
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument()
  })

  it('waits for state before redirecting', () => {
    hook.value = { state: null, connected: false }
    renderAt('/')
    expect(screen.getByText('Loading…')).toBeInTheDocument()
  })
})

describe('bot panels in the URL', () => {
  it('shows the profile in main with no side panel for ?panel=profile', async () => {
    renderAt('/bots/dev?panel=profile')
    expect(await within(screen.getByRole('main')).findByLabelText('Name')).toBeInTheDocument()
    expect(panel()).toBeNull()
    // The profile replaces the conversation.
    expect(screen.queryByRole('textbox', { name: 'Message' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))
    expect(where()).toBe('/bots/dev')
    expect(message()).toBeInTheDocument()
  })

  it('shows the Screen tab in the side panel for ?panel=computer and Routines for ?panel=routines', async () => {
    const first = renderAt('/bots/dev?panel=computer')
    await screen.findByRole('heading', { name: 'Dev' })
    expect(within(panel()!).getByRole('tab', { name: 'Screen' })).toHaveAttribute('aria-selected', 'true')
    expect(within(panel()!).getByTestId('screen-body')).toBeInTheDocument()
    expect(message()).toBeInTheDocument()
    first.unmount()

    renderAt('/bots/dev?panel=routines')
    expect(await within(panel()!).findByRole('button', { name: 'New routine' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Routines' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByTestId('screen-body')).toBeNull()
  })

  it('opens from the header buttons, closes by clicking again, and switches with the side tabs', async () => {
    renderAt('/bots/dev')
    await screen.findByRole('heading', { name: 'Dev' })
    expect(panel()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Computer' }))
    expect(where()).toBe('/bots/dev?panel=computer')
    expect(screen.getByRole('button', { name: 'Computer' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Computer' }))
    expect(where()).toBe('/bots/dev')
    expect(panel()).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Routines' }))
    expect(await screen.findByRole('button', { name: 'New routine' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Screen' }))
    expect(where()).toBe('/bots/dev?panel=computer')
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(where()).toBe('/bots/dev')

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(where()).toBe('/bots/dev?panel=profile')
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
  })

  it('keeps ?panel=profile when another bot is picked in the rail', async () => {
    renderAt('/bots/dev?panel=profile')
    await screen.findByDisplayValue('Dev')
    fireEvent.click(row('researcher'))
    expect(where()).toBe('/bots/researcher?panel=profile')
    expect(await screen.findByDisplayValue('Researcher')).toBeInTheDocument()
    expect(remembered()).toBeNull()
  })

  it('keeps the side panel, or none, when another bot is picked from a bot page', async () => {
    window.localStorage.setItem(SIDE_PANEL_KEY, 'routines')
    renderAt('/bots/dev?panel=computer')
    await screen.findByRole('heading', { name: 'Dev' })
    fireEvent.click(row('researcher'))
    expect(where()).toBe('/bots/researcher?panel=computer')
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    fireEvent.click(row('dev'))
    expect(where()).toBe('/bots/dev')
  })

  it('ignores an unknown panel value', async () => {
    renderAt('/bots/dev?panel=nope')
    await screen.findByRole('heading', { name: 'Dev' })
    expect(panel()).toBeNull()
    expect(message()).toBeInTheDocument()
  })

  it('closing the side panel unmounts the screen', async () => {
    renderAt('/bots/dev?panel=computer')
    await screen.findByTestId('screen-body')
    expect(screenLog.events).toEqual(['mount:dev'])
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(panel()).toBeNull()
    expect(screenLog.events).toEqual(['mount:dev', 'unmount:dev'])
  })

  it('unmounts the screen when the side panel moves to Routines, the profile opens or the bot changes', async () => {
    renderAt('/bots/dev?panel=computer')
    await screen.findByTestId('screen-body')
    fireEvent.click(screen.getByRole('tab', { name: 'Routines' }))
    expect(screenLog.events).toEqual(['mount:dev', 'unmount:dev'])
    fireEvent.click(screen.getByRole('tab', { name: 'Screen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(screenLog.events).toEqual(['mount:dev', 'unmount:dev', 'mount:dev', 'unmount:dev'])
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Computer' }))
    fireEvent.click(row('researcher'))
    expect(screenLog.events.slice(4)).toEqual(['mount:dev', 'unmount:dev', 'mount:researcher'])
  })
})

describe('side-panel memory (R4)', () => {
  it('a fresh browser opens the home bot with no panel; after the user opens Routines, home and the rail from Needs you open Routines', async () => {
    const fresh = renderAt('/')
    await screen.findByRole('heading', { name: 'Hermes' })
    expect(where()).toBe('/bots/default')
    expect(panel()).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Routines' }))
    expect(where()).toBe('/bots/default?panel=routines')
    expect(remembered()).toBe('routines')
    fresh.unmount()

    const home = renderAt('/')
    await screen.findByRole('heading', { name: 'Hermes' })
    expect(where()).toBe('/bots/default?panel=routines')
    home.unmount()

    renderAt('/needs-you')
    fireEvent.click(row('dev'))
    expect(where()).toBe('/bots/dev?panel=routines')
  })

  it('remembers the side tabs, Close panel and the header toggle, and never the profile', async () => {
    renderAt('/bots/dev?panel=routines')
    await screen.findByRole('heading', { name: 'Dev' })
    fireEvent.click(screen.getByRole('tab', { name: 'Screen' }))
    expect(remembered()).toBe('computer')
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to chat' }))
    expect(remembered()).toBe('computer')
    fireEvent.click(screen.getByRole('button', { name: 'Routines' }))
    expect(remembered()).toBe('routines')
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(remembered()).toBe('none')
    fireEvent.click(screen.getByRole('button', { name: 'Computer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Computer' }))
    expect(remembered()).toBe('none')
  })

  it('honours a direct URL exactly and never remembers it', async () => {
    window.localStorage.setItem(SIDE_PANEL_KEY, 'routines')
    const plain = renderAt('/bots/dev')
    await screen.findByRole('heading', { name: 'Dev' })
    expect(where()).toBe('/bots/dev')
    expect(panel()).toBeNull()
    expect(remembered()).toBe('routines')
    plain.unmount()

    window.localStorage.clear()
    for (const url of ['/bots/dev?panel=computer', '/bots/dev?panel=routines', '/bots/dev?panel=profile']) {
      const direct = renderAt(url)
      await screen.findByRole('heading', { name: 'Dev' })
      expect(where()).toBe(url)
      expect(remembered()).toBeNull()
      direct.unmount()
    }
  })

  it('renders closed and still works when storage is blocked', async () => {
    const blocked = () => { throw new DOMException('blocked', 'SecurityError') }
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    renderAt('/')
    await screen.findByRole('heading', { name: 'Hermes' })
    expect(where()).toBe('/bots/default')
    fireEvent.click(screen.getByRole('button', { name: 'Routines' }))
    expect(where()).toBe('/bots/default?panel=routines')
    get.mockRestore()
    set.mockRestore()
  })
})

describe('one chat session and drafts', () => {
  it('opens one chat session for a bot and keeps it while the profile shows', async () => {
    renderAt('/bots/dev')
    await screen.findByRole('heading', { name: 'Dev' })
    await waitFor(() => expect(message()).toBeEnabled())
    expect(client.callsOf('session.resume')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    await screen.findByLabelText('Name')
    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }))
    // Still connected at once: nothing was closed and re-opened.
    expect(message()).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Computer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(client.callsOf('session.resume')).toHaveLength(1)
    expect(client.callsOf('session.resume')[0]!.params).toMatchObject({ profile: 'dev' })
  })

  it('opens a new session for another bot and never shows the old bot’s chat under it', async () => {
    renderAt('/bots/dev')
    await waitFor(() => expect(message()).toBeEnabled())
    fireEvent.change(message(), { target: { value: 'for dev only' } })
    fireEvent.keyDown(message(), { key: 'Enter' })
    expect(await screen.findByText('for dev only')).toBeInTheDocument()
    fireEvent.click(row('researcher'))
    expect(screen.getByRole('heading', { name: 'Researcher' })).toBeInTheDocument()
    expect(screen.queryByText('for dev only')).toBeNull()
    await waitFor(() => expect(client.callsOf('session.resume').map(c => c.params.profile)).toEqual(['dev', 'researcher']))
  })

  it('keeps a composer draft per bot across the profile and a bot switch', async () => {
    renderAt('/bots/dev')
    await waitFor(() => expect(message()).toBeEnabled())
    fireEvent.change(message(), { target: { value: 'dev draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Back to chat' }))
    expect(message()).toHaveValue('dev draft')

    fireEvent.click(row('researcher'))
    expect(message()).toHaveValue('')
    fireEvent.change(message(), { target: { value: 'research draft' } })
    fireEvent.click(screen.getByRole('button', { name: 'Needs you' }))
    fireEvent.click(row('dev'))
    expect(message()).toHaveValue('dev draft')
    fireEvent.click(row('researcher'))
    expect(message()).toHaveValue('research draft')
    expect(window.localStorage.length).toBe(0)
  })

  it('keeps a group draft across leaving and returning', async () => {
    hook.value = { state: withGroup(), connected: true }
    renderAt('/groups/r1')
    await screen.findByRole('heading', { name: 'Launch' })
    fireEvent.change(message(), { target: { value: 'group draft' } })
    fireEvent.click(row('dev'))
    await screen.findByRole('heading', { name: 'Dev' })
    expect(message()).toHaveValue('')
    fireEvent.click(document.querySelector<HTMLElement>('[data-group="r1"]')!)
    await screen.findByRole('heading', { name: 'Launch' })
    expect(message()).toHaveValue('group draft')
  })
})

describe('window shortcuts', () => {
  it('⌘\\ opens Screen and closes the side panel, and does nothing on the profile or inside a field', async () => {
    renderAt('/bots/dev')
    await screen.findByRole('heading', { name: 'Dev' })
    toggleSide(message())
    expect(where()).toBe('/bots/dev')
    toggleSide()
    expect(where()).toBe('/bots/dev?panel=computer')
    expect(remembered()).toBe('computer')
    toggleSide()
    expect(where()).toBe('/bots/dev')
    expect(remembered()).toBe('none')

    fireEvent.click(screen.getByRole('button', { name: 'Routines' }))
    toggleSide()
    expect(where()).toBe('/bots/dev')

    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    toggleSide()
    expect(where()).toBe('/bots/dev?panel=profile')
    expect(remembered()).toBe('none')
  })

  it('⌘\\ and Esc do nothing while the user holds control of the screen, and ⌘\\ nothing off a bot page', async () => {
    renderAt('/bots/dev?panel=computer')
    await screen.findByTestId('screen-body')
    setLiveControlHeld(true)
    toggleSide()
    press({ key: 'Escape' })
    expect(where()).toBe('/bots/dev?panel=computer')
    setLiveControlHeld(false)
    fireEvent.click(screen.getByRole('button', { name: 'Needs you' }))
    toggleSide()
    expect(where()).toBe('/needs-you')
    expect(remembered()).toBeNull()
  })

  it('Esc leaves the profile and the Needs-you page, but not from a field or an open dialog', async () => {
    renderAt('/bots/dev?panel=profile&tab=advanced')
    const name = await screen.findByLabelText('Name')
    press({ key: 'Escape' }, name)
    expect(where()).toBe('/bots/dev?panel=profile&tab=advanced')
    press({ key: 'Escape' })
    expect(where()).toBe('/bots/dev')

    // From the queue, Esc goes back to the last bot page as it was.
    fireEvent.click(screen.getByRole('button', { name: 'Routines' }))
    fireEvent.click(screen.getByRole('button', { name: 'Needs you' }))
    expect(where()).toBe('/needs-you')
    fireEvent.click(screen.getByRole('button', { name: '+ New bot' }))
    press({ key: 'Escape' }, await screen.findByRole('dialog'))
    expect(where()).toBe('/needs-you')
    press({ key: 'Escape' })
    expect(where()).toBe('/bots/dev?panel=routines')

    // Esc on a plain chat does nothing.
    press({ key: 'Escape' })
    expect(where()).toBe('/bots/dev?panel=routines')
  })

  it('Esc on the Needs-you page goes home when no bot was open before', async () => {
    renderAt('/needs-you')
    press({ key: 'Escape' })
    expect(await screen.findByRole('heading', { name: 'Hermes' })).toBeInTheDocument()
    expect(where()).toBe('/bots/default')
  })

  it('d flips the theme, but not from a field or with a modifier', async () => {
    document.documentElement.dataset.theme = 'dark'
    renderAt('/bots/dev')
    await screen.findByRole('heading', { name: 'Dev' })
    press({ key: 'd' }, message())
    press({ key: 'd', ctrlKey: true })
    press({ key: 'd', repeat: true })
    expect(document.documentElement.dataset.theme).toBe('dark')
    press({ key: 'd' })
    expect(document.documentElement.dataset.theme).toBe('light')
    press({ key: 'D' })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })
})

describe('W7: a bot deleted elsewhere', () => {
  const rerenderAt = (path: string) => {
    const view = renderAt(path)
    return { ...view, again: () => view.rerender(<MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter>) }
  }

  it('goes home when the open bot disappears from the roster', async () => {
    const view = rerenderAt('/bots/dev')
    await screen.findByRole('heading', { name: 'Dev' })
    hook.value = { state: crewState({ bots: crewState().bots.filter(b => b.name !== 'dev') }), connected: true }
    view.again()
    expect(await screen.findByRole('heading', { name: 'Hermes' })).toBeInTheDocument()
  })

  it('does not redirect for a bot that has not appeared yet', () => {
    vi.useFakeTimers()
    rerenderAt('/bots/new-one')
    act(() => { vi.advanceTimersByTime(3100) })
    expect(screen.getByText('Bot not found')).toBeInTheDocument()
    vi.useRealTimers()
  })
})
