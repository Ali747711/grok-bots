import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { NeedsYouPage } from '@/features/needs-you/NeedsYouPage'
import type { PendingView } from '@/state/types'

import { bot, crewState } from './fixtures'

const NOW = 1_000_000_000
const pending = (id: string, profile: string, kind: PendingView['kind'], summary: string, ageS: number): PendingView => ({
  id, kind, profile, sessionId: 's', summary, receivedAt: NOW - ageS * 1000, source: 'event', state: 'open', answerable: true
})

const renderPage = (state = crewState(), crewConnected = true) =>
  render(<MemoryRouter><NeedsYouPage state={state} crewConnected={crewConnected} now={() => NOW} /></MemoryRouter>)

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-size={String(props.size)} /> }
})

describe('NeedsYouPage', () => {
  it('lists needs-you entries with avatars and links', () => {
    renderPage(crewState({ bots: [bot({ name: 'dev', title: 'Dev' })], pending: [pending('a', 'dev', 'approval', 'run it', 5)] }))
    const link = screen.getByText('run it').closest('a')!
    expect(link).toHaveAttribute('href', '/bots/dev')
    expect(within(link).getByTestId('stub')).toHaveAttribute('data-size', '32')
    expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(within(link).getByText('Open chat')).toHaveClass('text-sky-ink')
    expect(link.closest('ul')!.parentElement).not.toHaveClass('rounded-block')
  })

  it.each([
    ['Hermes offline', { hermes: 'offline' as const }, true],
    ['Crew stream down', {}, false]
  ])('hides live status on the rows while stale (%s)', (_label, over, connected) => {
    const bots = [bot({ name: 'dev', title: 'Dev', status: 'working' }), bot({ name: 'res', title: 'Res', status: 'needs_you' })]
    renderPage(crewState({ ...over, bots, pending: [pending('a', 'dev', 'approval', 'x', 5), pending('b', 'res', 'approval', 'y', 6)] }), connected)
    expect(screen.queryByRole('img', { name: 'Needs you', hidden: true })).toBeNull()
  })

  it('lists entries across bots and links to the chat', () => {
    renderPage(crewState({
      bots: [bot({ name: 'researcher', title: 'Researcher' }), bot({ name: 'dev', title: 'Dev' })],
      pending: [
        pending('a', 'researcher', 'approval', 'send summary email', 125),
        pending('b', 'dev', 'secret', 'API key for X', 7200)
      ]
    }))
    expect(screen.getByText('send summary email')).toBeInTheDocument()
    expect(screen.getByText('API key for X')).toBeInTheDocument()
    expect(screen.getByText('Researcher')).toBeInTheDocument()
    expect(screen.getByText('Approval')).toBeInTheDocument()
    expect(screen.getByText('Secret')).toBeInTheDocument()
    expect(screen.getByText('2m ago')).toBeInTheDocument()
    expect(screen.getByText('2h ago')).toBeInTheDocument()
    expect(screen.getByText('send summary email').closest('a')).toHaveAttribute('href', '/bots/researcher')
    expect(screen.getByText('API key for X').closest('a')).toHaveAttribute('href', '/bots/dev')
  })

  it('shows an empty state', () => {
    renderPage(crewState({ pending: [] }))
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument()
  })

  it('still lists a request whose bot is missing from the roster', () => {
    renderPage(crewState({ bots: [], pending: [pending('a', 'ghost', 'clarify', 'Which one?', 5)] }))
    expect(screen.getByText('ghost')).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
  })
})
