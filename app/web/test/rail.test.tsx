import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return {
    ...actual,
    BotAvatar: (props: Record<string, unknown>) => (
      <div data-testid="stub" data-type={String(props.type)} data-color={props.color === undefined ? '' : String(props.color)} data-size={String(props.size)} data-state={String(props.state)} />
    )
  }
})

import { Rail, type RailProps } from '@/features/rail/Rail'
import { setLiveControlHeld } from '@/lib/live-control'
import { THEME_STORAGE_KEY } from '@/lib/theme'
import type { CrewState, PendingView } from '@/state/types'

import { bot, crewState, gm, group } from './fixtures'

const pending = (id: string, over: Partial<PendingView> = {}): PendingView =>
  ({ id, kind: 'approval', profile: 'researcher', sessionId: 's', summary: 'rm', receivedAt: 1, source: 'event', state: 'open', answerable: true, ...over })

const handlers = () => ({ onSelect: vi.fn(), onSelectGroup: vi.fn(), onNeedsYou: vi.fn(), onNewGroup: vi.fn() })

function renderRail(state: CrewState | null = crewState(), over: Partial<RailProps> = {}) {
  const fns = handlers()
  const props: RailProps = { state, crewConnected: true, selected: null, selectedGroupId: null, needsYouActive: false, ...fns, ...over }
  const view = render(<Rail {...props} />)
  return { ...fns, ...view, rerender: (next: CrewState | null) => view.rerender(<Rail {...props} state={next} />) }
}

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
/** Answers every PATCH with `answer`; other calls (usage) get an empty object. */
function stubFetch(answer: () => Promise<Response> = () => json({ status: 'saved', detail: {} })) {
  const fn = vi.fn((_url: string, init: RequestInit = {}) => (init.method === 'PATCH' ? answer() : json({})))
  vi.stubGlobal('fetch', fn)
  return fn
}
const patches = (fn: ReturnType<typeof stubFetch>) =>
  fn.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([url, init]) => [url, JSON.parse(String(init?.body))])

const rowOf = (name: string) => document.querySelector<HTMLElement>(`[data-bot="${name}"]`)!
const open = (name: string) => within(rowOf(name)).getAllByRole('button')[0]!
const section = (name: string | RegExp) => screen.getByRole('group', { name })
const rowsIn = (name: string | RegExp) => [...section(name).querySelectorAll('[data-bot]')].map(r => r.getAttribute('data-bot'))
const find = () => screen.getByRole('searchbox', { name: 'Find a bot' })
const press = (init: KeyboardEventInit, target: Element = document.body) => fireEvent.keyDown(target, init)

const three = () => [
  bot({ name: 'default', title: 'Hermes', isPrimary: true, preview: 'Working on it', status: 'working' }),
  bot({ name: 'dev', title: 'Dev', preview: 'Idle', job: 'Fixes builds', role: 'engineer' }),
  bot({ name: 'scout', title: 'Scout', pinned: true })
]

beforeEach(() => {
  window.localStorage.clear()
  stubFetch()
})
afterEach(() => {
  setLiveControlHeld(false)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Rail header and sections', () => {
  it('shows Crew, the summary and the sections in order, each bot once', () => {
    renderRail(crewState({ bots: [...three(), bot({ name: 'ask', title: 'Ask', status: 'needs_you' }), bot({ name: 'old', title: 'Old', hidden: true })], pending: [pending('a', { profile: 'ask' })] }))
    expect(screen.getByRole('heading', { name: 'Crew' })).toHaveClass('text-[15px]', 'font-semibold')
    expect(screen.getByText('4 bots · 1 working')).toBeInTheDocument()
    expect(screen.getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Needs you', 'Pinned', 'Crew', 'Hidden (1)'])
    expect(rowsIn('Needs you')).toEqual(['ask'])
    expect(rowsIn('Pinned')).toEqual(['default', 'scout'])
    expect(rowsIn('Crew')).toEqual(['dev'])
    expect(document.querySelectorAll('[data-bot]')).toHaveLength(4)
  })

  it('shows the Needs-you header with Open all (n) even when only group requests are open', () => {
    const groupRequest = pending('g', { profile: 'dev', source: 'group', group: { roomId: 'r1', memberId: 'dev', taskId: 't', requestId: 'q' } })
    const { onNeedsYou } = renderRail(crewState({ bots: three(), pending: [groupRequest, pending('h', { profile: 'gone' })] }))
    expect(rowsIn('Needs you')).toEqual([])
    fireEvent.click(within(section('Needs you')).getByRole('button', { name: 'Open all (2)' }))
    expect(onNeedsYou).toHaveBeenCalledTimes(1)
  })

  it('has no Needs-you section with nothing open, and marks Open all as the current page on the queue', () => {
    const { unmount } = renderRail(crewState({ bots: three() }))
    expect(screen.queryByRole('group', { name: 'Needs you' })).toBeNull()
    unmount()
    renderRail(crewState({ bots: three(), pending: [pending('a')] }), { needsYouActive: true })
    expect(screen.getByRole('button', { name: 'Open all (1)' })).toHaveAttribute('aria-current', 'page')
  })

  it('opens a bot, marks the selected row and shows its preview, badges and status as text', () => {
    const bots = [...three(), bot({ name: 'half', title: 'Half', setupIncomplete: true, sandbox: 'on' })]
    const { onSelect } = renderRail(crewState({ bots }), { selected: 'dev' })
    fireEvent.click(open('half'))
    expect(onSelect).toHaveBeenCalledWith('half')
    expect(open('dev')).toHaveAttribute('aria-current', 'page')
    expect(open('half')).not.toHaveAttribute('aria-current')
    expect(within(open('default')).getByText('Working on it')).toBeInTheDocument()
    expect(within(open('default')).getByText('Working.')).toHaveClass('sr-only')
    expect(within(open('half')).getByText('Finish setup')).toBeInTheDocument()
    expect(within(rowOf('half')).getByRole('img', { name: 'Sandboxed' }).tagName).toBe('SPAN')
    expect(screen.getAllByRole('img', { name: 'Sandboxed' })).toHaveLength(1)
  })

  it('draws 32 px avatars with a status dot and truncates long and Korean names', () => {
    const long = 'x'.repeat(80)
    renderRail(crewState({ bots: [bot({ name: 'long', title: long, avatar: { type: 'cat', color: '#16a34a' } }), bot({ name: 'ko', title: '한글 봇' }), bot({ name: 'pic', title: 'Pic', imageKind: 'photo', hasAvatar: true })] }))
    const stub = within(open('long')).getByTestId('stub')
    expect(stub).toHaveAttribute('data-size', '32')
    expect(stub).toHaveAttribute('data-type', 'cat')
    expect(stub).toHaveAttribute('data-color', '#16a34a')
    expect(open('long').querySelector('.bg-status-idle')).not.toBeNull()
    expect(screen.getByText(long)).toHaveClass('truncate')
    expect(screen.getByText('한글 봇')).toHaveClass('truncate')
    expect(open('pic').querySelector('img')).toHaveAttribute('src', '/crew/avatars/pic')
    expect(open('pic').querySelector('img')).toHaveAttribute('alt', '')
  })

  it('keeps Hidden collapsed until it is opened, and offers Show there', () => {
    renderRail(crewState({ bots: [...three(), bot({ name: 'old', title: 'Old', hidden: true })] }))
    expect(screen.queryByText('Old')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hidden (1)' }))
    expect(rowsIn(/^Hidden/)).toEqual(['old'])
    expect(within(rowOf('old')).getByRole('button', { name: 'Show Old' })).toBeInTheDocument()
    expect(within(rowOf('old')).queryByRole('button', { name: /^(Hide|Pin) / })).toBeNull()
  })

  it('has no Hidden section when nothing is hidden', () => {
    renderRail(crewState({ bots: three() }))
    expect(screen.queryByRole('button', { name: /Hidden/ })).toBeNull()
  })

  it('puts Groups after Crew and before Hidden, and skips it on an older server', () => {
    const groups = { available: true, seatable: ['dev'], rooms: [group({ id: 'r1', name: 'Launch', members: [gm('dev')] })] }
    const { onSelectGroup, onNewGroup, unmount } = renderRail(crewState({ bots: [...three(), bot({ name: 'old', title: 'Old', hidden: true })], groups }), { selectedGroupId: 'r1' })
    expect(screen.getAllByRole('group').map(g => g.getAttribute('aria-label'))).toEqual(['Pinned', 'Crew', 'Groups', 'Hidden (1)'])
    const row = document.querySelector<HTMLElement>('[data-group="r1"]')!
    expect(row).toHaveAttribute('aria-current', 'page')
    fireEvent.click(row)
    expect(onSelectGroup).toHaveBeenCalledWith('r1')
    fireEvent.click(screen.getByRole('button', { name: 'New group' }))
    expect(onNewGroup).toHaveBeenCalled()
    unmount()
    renderRail(crewState({ bots: three() }))
    expect(screen.queryByRole('group', { name: 'Groups' })).toBeNull()
  })

  it('shows a skeleton before the first state and a friendly empty rail', () => {
    const { unmount } = renderRail(null)
    expect(screen.getByRole('heading', { name: 'Crew' })).toBeInTheDocument()
    expect(screen.getAllByTestId('roster-skeleton').length).toBeGreaterThan(0)
    expect(screen.queryByRole('status')).toBeNull()
    unmount()
    renderRail(crewState({ bots: [] }))
    expect(screen.getByText('No bots yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New bot' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ New bot' })).toBeInTheDocument()
  })
})

describe('Rail New bot panel', () => {
  const panel = () => screen.getByRole('dialog', { name: 'New bot' })
  const made = { name: 'e2e123', complete: true, steps: { profile: 'ok', apps: 'ok', look: 'ok', avatar: 'skipped', chat: 'ok', sandbox: 'skipped' }, needsModel: false }

  it('opens the panel from + New bot and from the empty rail, and gives focus back to + New bot', async () => {
    renderRail(crewState({ bots: [] }))
    fireEvent.click(screen.getByRole('button', { name: '+ New bot' }))
    expect(panel()).toBeInTheDocument()
    fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: 'New bot' }))
    expect(panel()).toBeInTheDocument()
    fireEvent.keyDown(within(panel()).getByLabelText('Name'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.getByRole('button', { name: '+ New bot' })).toHaveFocus())
  })

  it('opens the created bot through onSelect', async () => {
    const fetchFn = vi.fn((url: string, _init?: RequestInit) => (url === '/crew/bots' ? json(made, 201) : json({})))
    vi.stubGlobal('fetch', fetchFn)
    const { onSelect } = renderRail(crewState({ bots: three() }))
    fireEvent.click(screen.getByRole('button', { name: '+ New bot' }))
    fireEvent.change(within(panel()).getByLabelText('Name'), { target: { value: 'E2e123' } })
    fireEvent.click(within(panel()).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith('e2e123'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('⌥digit and ⌘K do nothing while the panel has focus, on a field or on a button', async () => {
    const { onSelect } = renderRail(crewState({ bots: three() }))
    fireEvent.click(screen.getByRole('button', { name: '+ New bot' }))
    const name = within(panel()).getByLabelText('Name')
    await waitFor(() => expect(name).toHaveFocus())
    press({ key: '2', code: 'Digit2', altKey: true }, name)
    press({ key: 'k', ctrlKey: true }, name)
    const close = within(panel()).getByRole('button', { name: 'Close' })
    close.focus()
    press({ key: '2', code: 'Digit2', altKey: true }, close)
    press({ key: 'k', ctrlKey: true }, close)
    expect(close).toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled()
    expect(panel()).toBeInTheDocument()
  })
})

describe('Rail pin and hide', () => {
  it('pins and unpins with aria-pressed and PATCH {pinned}', async () => {
    const fetchFn = stubFetch()
    const view = renderRail(crewState({ bots: three() }))
    const pin = within(rowOf('dev')).getByRole('button', { name: 'Pin Dev' })
    expect(pin).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(pin)
    await waitFor(() => expect(patches(fetchFn)).toEqual([['/crew/bots/dev', { pinned: true }]]))

    view.rerender(crewState({ bots: three().map(b => (b.name === 'dev' ? { ...b, pinned: true } : b)) }))
    expect(rowsIn('Pinned')).toEqual(['default', 'dev', 'scout'])
    const unpin = within(rowOf('dev')).getByRole('button', { name: 'Pin Dev' })
    expect(unpin).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(unpin).toBeEnabled())
    fireEvent.click(unpin)
    await waitFor(() => expect(patches(fetchFn)).toHaveLength(2))
    expect(patches(fetchFn)[1]).toEqual(['/crew/bots/dev', { pinned: false }])
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('says so when a pin does not save', async () => {
    stubFetch(() => json({ error: 'hermes_offline' }, 502))
    renderRail(crewState({ bots: three() }))
    fireEvent.click(within(rowOf('dev')).getByRole('button', { name: 'Pin Dev' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't pin Dev. Try again."))
    stubFetch(() => json({ status: 'conflict' }, 409))
    fireEvent.click(within(rowOf('scout')).getByRole('button', { name: 'Pin Scout' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't unpin Scout. Try again."))
  })

  it('hides a bot and toasts', async () => {
    const fetchFn = stubFetch()
    renderRail(crewState({ bots: three() }))
    fireEvent.click(within(rowOf('dev')).getByRole('button', { name: 'Hide Dev' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Bot hidden'))
    expect(patches(fetchFn)).toEqual([['/crew/bots/dev', { hidden: true }]])
  })

  it('shows a hidden bot again and toasts, and says so when hiding fails', async () => {
    const fetchFn = stubFetch()
    renderRail(crewState({ bots: [...three(), bot({ name: 'old', title: 'Old', hidden: true })] }))
    fireEvent.click(screen.getByRole('button', { name: 'Hidden (1)' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show Old' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Bot shown'))
    expect(patches(fetchFn)).toEqual([['/crew/bots/old', { hidden: false }]])
    stubFetch(() => Promise.reject(new Error('network')))
    fireEvent.click(within(rowOf('dev')).getByRole('button', { name: 'Hide Dev' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't hide Dev. Try again."))
    expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it('shows the primary with a Primary tag and no pin or hide', () => {
    renderRail(crewState({ bots: [bot({ name: 'default', title: 'Hermes', isPrimary: true, pinned: true }), ...three().slice(1)] }))
    expect(within(rowOf('default')).getByText('Primary')).toBeInTheDocument()
    expect(within(rowOf('default')).getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^(Pin|Hide|Show) Hermes$/ })).toBeNull()
    expect(screen.getAllByText('Primary')).toHaveLength(1)
  })

  it('offers no pin or hide on a half-made bot: a write would end Finish setup (final review 1)', () => {
    renderRail(crewState({ bots: [...three(), bot({ name: 'half', title: 'Half', setupIncomplete: true })] }))
    expect(within(rowOf('half')).getByText('Finish setup')).toBeInTheDocument()
    expect(within(rowOf('half')).getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^(Pin|Hide|Show) Half$/ })).toBeNull()
    // A finished bot keeps both, out of the pointer's way until the row is hovered or focused.
    const actions = within(rowOf('dev')).getByRole('button', { name: 'Pin Dev' }).parentElement!
    expect(actions).toHaveClass('pointer-events-none', 'group-hover:pointer-events-auto', 'group-focus-within:pointer-events-auto')
  })

  it('keeps focus on the pin button when the row moves to another section', async () => {
    const view = renderRail(crewState({ bots: three() }))
    const pin = within(rowOf('dev')).getByRole('button', { name: 'Pin Dev' })
    pin.focus()
    fireEvent.click(pin)
    await waitFor(() => expect(pin).toBeEnabled())
    view.rerender(crewState({ bots: three().map(b => (b.name === 'dev' ? { ...b, pinned: true } : b)) }))
    expect(within(rowOf('dev')).getByRole('button', { name: 'Pin Dev' })).toHaveFocus()
  })
})

describe('Rail connection', () => {
  it('shows the connection chip text and dims rows without statuses while offline', () => {
    const { unmount } = renderRail(crewState({ hermes: 'offline', pending: [pending('a')] }))
    expect(screen.getByRole('status')).toHaveTextContent('Hermes offline')
    expect(screen.getByText('3 bots')).toBeInTheDocument()
    for (const row of document.querySelectorAll('[data-bot]')) expect(row).toHaveClass('opacity-50')
    for (const stub of screen.getAllByTestId('stub')) expect(stub).not.toHaveAttribute('data-state', 'working')
    expect(document.querySelector('[data-bot] .bg-status-working, [data-bot] .bg-status-waiting, [data-bot] .bg-status-idle')).toBeNull()
    expect(screen.queryByText('Working.')).toBeNull()
    // A needing bot stays in its usual section while statuses are hidden.
    expect(rowsIn('Needs you')).toEqual([])
    expect(rowsIn('Crew')).toEqual(['researcher', 'dev'])
    unmount()
    renderRail(crewState(), { crewConnected: false })
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting…')
    expect(rowOf('dev')).toHaveClass('opacity-50')
  })

  it('names connecting and signed out, and shows no chip when connected', () => {
    const first = renderRail(crewState({ hermes: 'connecting' }))
    expect(screen.getByRole('status')).toHaveTextContent('Connecting…')
    first.unmount()
    const second = renderRail(crewState({ hermes: 'signed_out' }))
    expect(screen.getByRole('status')).toHaveTextContent('Signed out of Hermes')
    second.unmount()
    renderRail()
    expect(screen.queryByRole('status')).toBeNull()
    expect(rowOf('dev')).not.toHaveClass('opacity-50')
  })
})

describe('Rail find', () => {
  it('filters by title, handle, job and role, and hides Groups while finding', () => {
    const groups = { available: true, seatable: ['dev'], rooms: [group({ id: 'r1', name: 'Launch', members: [gm('dev')] })] }
    renderRail(crewState({ bots: three(), groups }))
    expect(find()).toHaveAttribute('type', 'search')
    expect(find()).toHaveAttribute('placeholder', 'Find a bot')
    fireEvent.change(find(), { target: { value: 'fix' } })
    expect([...document.querySelectorAll('[data-bot]')].map(r => r.getAttribute('data-bot'))).toEqual(['dev'])
    expect(screen.queryByRole('group', { name: 'Groups' })).toBeNull()
    fireEvent.change(find(), { target: { value: 'ENGINEER' } })
    expect(rowsIn('Crew')).toEqual(['dev'])
    fireEvent.change(find(), { target: { value: 'scou' } })
    expect(rowsIn('Pinned')).toEqual(['scout'])
    fireEvent.change(find(), { target: { value: '' } })
    expect(document.querySelectorAll('[data-bot]')).toHaveLength(3)
    expect(screen.getByRole('group', { name: 'Groups' })).toBeInTheDocument()
  })

  it('says No bot matches', () => {
    renderRail(crewState({ bots: three() }))
    expect(screen.queryByText('No bot matches')).toBeNull()
    fireEvent.change(find(), { target: { value: 'zzz' } })
    expect(screen.getByText('No bot matches')).toBeInTheDocument()
    expect(document.querySelectorAll('[data-bot]')).toHaveLength(0)
  })
})

describe('Rail keys', () => {
  it('⌘K focuses Find, ⌥2 opens the second visible bot and ↑/↓ move between rows', () => {
    const { onSelect } = renderRail(crewState({ bots: three() }))
    expect(screen.getByText('Ctrl K')).toBeInTheDocument()
    press({ key: 'k', ctrlKey: true })
    expect(find()).toHaveFocus()
    find().blur()
    // Visible order: Pinned (Hermes, Scout), then Crew (Dev).
    press({ key: '™', code: 'Digit2', altKey: true })
    expect(onSelect).toHaveBeenLastCalledWith('scout')
    press({ key: '£', code: 'Digit3', altKey: true })
    expect(onSelect).toHaveBeenLastCalledWith('dev')
    // No ninth row, no ⌥, or ⌥ with another modifier: nothing happens.
    for (const init of [{ code: 'Digit9', altKey: true }, { code: 'Digit2' }, { code: 'Digit2', altKey: true, ctrlKey: true }]) press({ key: '2', ...init })
    expect(onSelect).toHaveBeenCalledTimes(2)
    fireEvent.change(find(), { target: { value: 'dev' } })
    press({ key: '1', code: 'Digit1', altKey: true })
    expect(onSelect).toHaveBeenLastCalledWith('dev')
    fireEvent.change(find(), { target: { value: '' } })
    open('default').focus()
    press({ key: 'ArrowDown' }, open('default'))
    expect(open('scout')).toHaveFocus()
    press({ key: 'ArrowDown' }, open('scout'))
    expect(open('dev')).toHaveFocus()
    press({ key: 'ArrowDown' }, open('dev'))
    expect(open('default')).toHaveFocus()
    press({ key: 'ArrowUp' }, open('default'))
    expect(open('dev')).toHaveFocus()
  })

  it('⌘K also answers to the K key of another layout, but not while an IME composes (final review 5)', () => {
    renderRail(crewState({ bots: three() }))
    press({ key: 'ㅏ', code: 'KeyK', ctrlKey: true, isComposing: true })
    expect(find()).not.toHaveFocus()
    press({ key: 'ㅏ', code: 'KeyK', ctrlKey: true })
    expect(find()).toHaveFocus()
  })

  it('⌥digit and ⌘K do nothing from inside the live view or a field', () => {
    const { onSelect } = renderRail(crewState({ bots: three() }))
    const live = document.createElement('div')
    live.setAttribute('data-testid', 'live-view')
    live.innerHTML = '<button type="button">screen</button>'
    const field = document.createElement('textarea')
    document.body.append(live, field)
    const inside = live.querySelector('button')!
    inside.focus()
    press({ key: '2', code: 'Digit2', altKey: true }, inside)
    press({ key: 'k', ctrlKey: true }, inside)
    // Focus in the screen is enough, wherever the event started.
    press({ key: '2', code: 'Digit2', altKey: true })
    expect(inside).toHaveFocus()
    field.focus()
    press({ key: '2', code: 'Digit2', altKey: true }, field)
    press({ key: 'k', ctrlKey: true }, field)
    expect(field).toHaveFocus()
    field.blur()
    setLiveControlHeld(true)
    press({ key: '2', code: 'Digit2', altKey: true })
    press({ key: 'k', ctrlKey: true })
    expect(find()).not.toHaveFocus()
    expect(onSelect).not.toHaveBeenCalled()
    setLiveControlHeld(false)
    press({ key: '2', code: 'Digit2', altKey: true })
    expect(onSelect).toHaveBeenCalledWith('scout')
    for (const node of [live, field]) node.remove()
  })

  it('⌥digit does nothing while a dialog is open over the rail', async () => {
    const { onSelect } = renderRail(crewState({ bots: three() }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    const dialog = await screen.findByRole('dialog')
    press({ key: '2', code: 'Digit2', altKey: true }, within(dialog).getAllByRole('button')[0])
    expect(onSelect).not.toHaveBeenCalled()
  })
})

describe('Rail footer', () => {
  it('opens Apps and Settings and sets the theme from the menu', async () => {
    vi.stubGlobal('fetch', vi.fn(() => json({ apps: [], usage: {} })))
    renderRail()
    fireEvent.click(screen.getByRole('button', { name: 'Apps' }))
    expect(await screen.findByText('Apps your bots can use, through Composio.')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(await screen.findByText('Bots working at the same time')).toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: 'Close' })[0]!)

    const theme = screen.getByRole('button', { name: 'Theme' })
    fireEvent.pointerDown(theme)
    fireEvent.click(theme)
    const items = await screen.findAllByRole('menuitemradio')
    expect(items.map(i => i.textContent)).toEqual(['System', 'Light', 'Dark'])
    expect(screen.getByRole('menuitemradio', { name: 'System' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Light' }))
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('polls /crew/usage once and shows the credit pill', async () => {
    const fetchFn = vi.fn((_url: string) => json({ state: 'ok', remaining: 2 }))
    vi.stubGlobal('fetch', fetchFn)
    renderRail()
    expect(await screen.findByText('$2.00 credit left')).toBeInTheDocument()
    expect(screen.getByTestId('credit-pill')).toBeInTheDocument()
    expect(fetchFn.mock.calls.filter(([url]) => url === '/crew/usage')).toHaveLength(1)
    await act(async () => undefined)
  })
})
