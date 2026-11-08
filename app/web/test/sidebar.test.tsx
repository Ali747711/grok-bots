import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Sidebar } from '@/features/roster/Sidebar'
import type { PendingView } from '@/state/types'

import { bot, crewState } from './fixtures'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return {
    ...actual,
    BotAvatar: (props: Record<string, unknown>) => (
      <div data-testid="stub" data-type={String(props.type)} data-color={props.color === undefined ? '' : String(props.color)} data-size={String(props.size)} data-state={String(props.state)} />
    )
  }
})

const pending = (id: string): PendingView => ({
  id, kind: 'approval', profile: 'researcher', sessionId: 's', summary: 'rm', receivedAt: 1,
  source: 'event', state: 'open', answerable: true
})

const renderSidebar = (state = crewState(), selected: string | null = null, onSelect = vi.fn()) =>
  render(<Sidebar state={state} selected={selected} onSelect={onSelect} />)

function expectNoStatusShown() {
  for (const stub of screen.getAllByTestId('stub')) expect(stub).not.toHaveAttribute('data-state', 'working')
  expect(screen.queryAllByRole('img', { name: 'Needs you', hidden: true })).toHaveLength(0)
}

describe('Sidebar', () => {
  it('lists the primary bot first, then the others, with status dots', () => {
    renderSidebar()
    const primary = screen.getByRole('group', { name: 'Primary' })
    expect(within(primary).getByText('Hermes')).toBeInTheDocument()
    const others = screen.getByRole('group', { name: 'Bots' })
    const names = within(others).getAllByRole('button').map(b => b.getAttribute('data-bot'))
    expect(names).toEqual(['researcher', 'dev'])
    expect(within(screen.getByRole('button', { name: /Hermes/ })).getByTestId('stub')).toHaveAttribute('data-state', 'working')
    expect(within(screen.getByRole('button', { name: /Dev/ })).getByTestId('stub')).toHaveAttribute('data-state', 'default')
    expect(within(screen.getByRole('button', { name: /Researcher/ })).getByRole('img', { name: 'Needs you', hidden: true })).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'Needs you', hidden: true })).toHaveLength(1)
  })

  it('shows the preview line', () => {
    renderSidebar()
    expect(screen.getByText('Working on it')).toBeInTheDocument()
  })

  it('shows the needs-you count only when there are open requests', () => {
    const { unmount } = renderSidebar(crewState({ pending: [pending('a'), pending('b')] }))
    expect(screen.getByTestId('needs-you-count')).toHaveTextContent('2')
    unmount()
    renderSidebar()
    expect(screen.queryByTestId('needs-you-count')).toBeNull()
  })

  it('shows the hermes offline banner and dims the roster without statuses', () => {
    renderSidebar(crewState({ hermes: 'offline' }))
    expect(screen.getByText('Hermes is offline')).toBeInTheDocument()
    expectNoStatusShown()
    expect(screen.getByTestId('roster')).toHaveAttribute('data-stale', 'true')
  })

  it('shows banners for connecting and signed out', () => {
    const { unmount } = renderSidebar(crewState({ hermes: 'connecting' }))
    expect(screen.getByText('Connecting to Hermes…')).toBeInTheDocument()
    unmount()
    renderSidebar(crewState({ hermes: 'signed_out' }))
    expect(screen.getByText(/signed out of Hermes/i)).toBeInTheDocument()
  })

  it('has no banner when connected', () => {
    renderSidebar()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('calls onSelect with the bot name and marks the selected row', () => {
    const onSelect = vi.fn()
    renderSidebar(crewState(), 'dev', onSelect)
    fireEvent.click(screen.getByRole('button', { name: /Researcher/ }))
    expect(onSelect).toHaveBeenCalledWith('researcher')
    expect(screen.getByRole('button', { name: /Dev/ })).toHaveAttribute('aria-current', 'true')
  })

  it('renders avatars: photo for a photo bot, a fur avatar otherwise, at 36 px', () => {
    renderSidebar(crewState({
      bots: [
        bot({ name: 'default', title: 'Hermes', isPrimary: true }),
        bot({ name: 'pic', title: 'Pic', imageKind: 'photo', hasAvatar: true }),
        bot({ name: 'dev', title: 'Dev', avatar: { type: 'cat', color: '#16a34a' } })
      ]
    }))
    const pic = screen.getByRole('button', { name: 'Pic' })
    expect(pic.querySelector('img')).toHaveAttribute('src', '/crew/avatars/pic')
    expect(pic.querySelector('img')).toHaveAttribute('alt', '')
    const dev = within(screen.getByRole('button', { name: 'Dev' })).getByTestId('stub')
    expect(dev).toHaveAttribute('data-type', 'cat')
    expect(dev).toHaveAttribute('data-color', '#16a34a')
    expect(dev).toHaveAttribute('data-size', '36')
    expect(within(screen.getByRole('button', { name: 'Hermes' })).getByTestId('stub')).toBeInTheDocument()
  })

  it('truncates long and Korean names without stretching the row', () => {
    const long = 'x'.repeat(80)
    renderSidebar(crewState({ bots: [bot({ name: 'long', title: long }), bot({ name: 'ko', title: '한글 봇' })] }))
    expect(screen.getByText(long)).toHaveClass('truncate')
    expect(screen.getByText('한글 봇')).toHaveClass('truncate')
    expect(within(screen.getByText(long).closest('button')!).getByTestId('stub').parentElement!.parentElement).toHaveStyle({ width: '36px', height: '36px' })
  })

  it('marks the selected bot with the sky style', () => {
    renderSidebar(crewState(), 'dev')
    const row = screen.getByRole('button', { name: /Dev/ })
    expect(row).toHaveAttribute('data-selected', 'true')
    expect(row).toHaveClass('bg-sky-soft')
    expect(screen.getByRole('button', { name: /Researcher/ })).not.toHaveAttribute('data-selected')
  })

  it('shows mono section labels and the lime needs-you count', () => {
    renderSidebar(crewState({ pending: [pending('a')] }))
    expect(within(screen.getByRole('group', { name: 'Primary' })).getByText('Primary')).toHaveClass('label-mono')
    expect(within(screen.getByRole('group', { name: 'Bots' })).getByText('Bots')).toHaveClass('label-mono')
    expect(screen.getByTestId('needs-you-count')).toHaveClass('bg-primary', 'text-primary-foreground')
  })

  it('renders a loading sidebar before the first state', () => {
    render(<Sidebar state={null} selected={null} onSelect={() => undefined} />)
    expect(screen.getByText('Crew')).toBeInTheDocument()
  })

  it('treats the roster as stale and says so when the Crew stream is down', () => {
    render(<Sidebar state={crewState()} selected={null} onSelect={() => undefined} crewConnected={false} />)
    expect(screen.getByText('Reconnecting to Crew…')).toBeInTheDocument()
    expect(screen.getByTestId('roster')).toHaveAttribute('data-stale', 'true')
    expectNoStatusShown()
  })

  it('marks the Needs you row like a selected bot when its page is open', () => {
    render(<Sidebar state={crewState()} selected={null} onSelect={() => undefined} needsYouActive />)
    const row = screen.getByRole('button', { name: /Needs you/ })
    expect(row).toHaveClass('bg-sky-soft')
    expect(row).toHaveAttribute('aria-current', 'page')
    expect(row).toHaveAttribute('data-selected', 'true')
  })

  it('opens the Needs you view', () => {
    const onNeedsYou = vi.fn()
    render(<Sidebar state={crewState()} selected={null} onSelect={() => undefined} onNeedsYou={onNeedsYou} />)
    fireEvent.click(screen.getByRole('button', { name: /Needs you/ }))
    expect(onNeedsYou).toHaveBeenCalled()
  })

  it('lists hidden bots only under Hidden', () => {
    renderSidebar(crewState({
      bots: [bot({ name: 'default', title: 'Hermes', isPrimary: true }), bot({ name: 'dev', title: 'Dev' }), bot({ name: 'old', title: 'Old', hidden: true })]
    }))
    expect(screen.queryByText('Old')).toBeNull()
    expect(within(screen.getByRole('group', { name: 'Bots' })).queryByText('Old')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hidden (1)' }))
    expect(screen.getByText('Old')).toBeInTheDocument()
  })

  it('has no Hidden section when nothing is hidden', () => {
    renderSidebar()
    expect(screen.queryByRole('button', { name: /Hidden/ })).toBeNull()
  })

  it('marks a bot whose setup is unfinished and still opens it', () => {
    const onSelect = vi.fn()
    renderSidebar(crewState({ bots: [bot({ name: 'half', title: 'Half', setupIncomplete: true })] }), null, onSelect)
    expect(screen.getByText('Finish setup')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Half/ }))
    expect(onSelect).toHaveBeenCalledWith('half')
  })

  it('shows + New bot only when a handler is given', () => {
    const onNewBot = vi.fn()
    const { unmount } = renderSidebar()
    expect(screen.queryByRole('button', { name: '+ New bot' })).toBeNull()
    unmount()
    render(<Sidebar state={crewState()} selected={null} onSelect={() => undefined} onNewBot={onNewBot} />)
    fireEvent.click(screen.getByRole('button', { name: '+ New bot' }))
    expect(onNewBot).toHaveBeenCalled()
  })

  it('opens the settings dialog from the gear button', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}'))))
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(screen.getByText('Bots working at the same time')).toBeInTheDocument()
    vi.unstubAllGlobals()
  })
})

describe('Sidebar usage polling', () => {
  it('fetches /crew/usage once with the settings dialog closed', async () => {
    const fetchFn = vi.fn((_url: string) => Promise.resolve(new Response(JSON.stringify({ state: 'ok', remaining: 2 }))))
    vi.stubGlobal('fetch', fetchFn)
    renderSidebar()
    await screen.findByText('$2.00 credit left')
    expect(fetchFn.mock.calls.filter(([url]) => url === '/crew/usage')).toHaveLength(1)
    vi.unstubAllGlobals()
  })
})
