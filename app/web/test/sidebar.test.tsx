import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Sidebar } from '@/features/roster/Sidebar'
import type { PendingView } from '@/state/types'

import { bot, crewState } from './fixtures'

const pending = (id: string): PendingView => ({
  id, kind: 'approval', profile: 'researcher', sessionId: 's', summary: 'rm', receivedAt: 1,
  source: 'event', state: 'open', answerable: true
})

const renderSidebar = (state = crewState(), selected: string | null = null, onSelect = vi.fn()) =>
  render(<Sidebar state={state} selected={selected} onSelect={onSelect} />)

describe('Sidebar', () => {
  it('lists the primary bot first, then the others, with status dots', () => {
    renderSidebar()
    const primary = screen.getByRole('group', { name: 'Primary' })
    expect(within(primary).getByText('Hermes')).toBeInTheDocument()
    const others = screen.getByRole('group', { name: 'Bots' })
    const names = within(others).getAllByRole('button').map(b => b.getAttribute('data-bot'))
    expect(names).toEqual(['researcher', 'dev'])
    expect(screen.getByTestId('status-default')).toHaveAttribute('data-status', 'working')
    expect(screen.getByTestId('status-researcher')).toHaveAttribute('data-status', 'needs_you')
    expect(screen.getByTestId('status-dev')).toHaveAttribute('data-status', 'idle')
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
    expect(screen.queryByTestId('status-default')).toBeNull()
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

  it('renders avatars: image when present, initial otherwise, circle vs rounded', () => {
    renderSidebar(crewState({
      bots: [
        bot({ name: 'default', title: 'Hermes', isPrimary: true }),
        bot({ name: 'pic', title: 'Pic', hasAvatar: true }),
        bot({ name: 'dev', title: 'Dev', shape: 'circle', color: '#16a34a' })
      ]
    }))
    expect(screen.getByAltText('Pic')).toHaveAttribute('src', '/crew/avatars/pic')
    const hermes = screen.getByTestId('avatar-default')
    expect(hermes).toHaveTextContent('H')
    expect(hermes).toHaveStyle({ backgroundColor: '#8b5cf6' })
    expect(hermes.className).toContain('rounded-[10px]')
    const dev = screen.getByTestId('avatar-dev')
    expect(dev).toHaveStyle({ backgroundColor: '#16a34a' })
    expect(dev.className).toContain('rounded-full')
  })

  it('renders a loading sidebar before the first state', () => {
    render(<Sidebar state={null} selected={null} onSelect={() => undefined} />)
    expect(screen.getByText('Crew')).toBeInTheDocument()
  })

  it('treats the roster as stale and says so when the Crew stream is down', () => {
    render(<Sidebar state={crewState()} selected={null} onSelect={() => undefined} crewConnected={false} />)
    expect(screen.getByText('Reconnecting to Crew…')).toBeInTheDocument()
    expect(screen.getByTestId('roster')).toHaveAttribute('data-stale', 'true')
    expect(screen.queryByTestId('status-default')).toBeNull()
  })

  it('opens the Needs you view', () => {
    const onNeedsYou = vi.fn()
    render(<Sidebar state={crewState()} selected={null} onSelect={() => undefined} onNeedsYou={onNeedsYou} />)
    fireEvent.click(screen.getByRole('button', { name: /Needs you/ }))
    expect(onNeedsYou).toHaveBeenCalled()
  })
})
