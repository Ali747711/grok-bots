import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { NeedsYouPage } from '@/features/needs-you/NeedsYouPage'
import type { PendingView } from '@/state/types'

import { bot, crewState } from './fixtures'

const NOW = 1_000_000_000
const pending = (id: string, profile: string, kind: PendingView['kind'], summary: string, ageS: number): PendingView => ({
  id, kind, profile, sessionId: 's', summary, receivedAt: NOW - ageS * 1000, source: 'event', state: 'open', answerable: true
})

const renderPage = (state = crewState()) => render(<MemoryRouter><NeedsYouPage state={state} now={() => NOW} /></MemoryRouter>)

describe('NeedsYouPage', () => {
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
