import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NeedsYouPage } from '@/features/needs-you/NeedsYouPage'
import type { PendingView } from '@/state/types'

import { bot, crewState, group } from './fixtures'

const NOW = 1_000_000_000
const pending = (id: string, profile: string, kind: PendingView['kind'], summary: string, ageS: number): PendingView => ({
  id, kind, profile, sessionId: 's', summary, receivedAt: NOW - ageS * 1000, source: 'event', state: 'open', answerable: true
})

const renderPage = (state = crewState(), crewConnected = true) =>
  render(<MemoryRouter><NeedsYouPage state={state} crewConnected={crewConnected} now={() => NOW} /></MemoryRouter>)

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-size={String(props.size)} data-state={String(props.state)} /> }
})

const flush = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 0)))
const linkOf = (summary: string) => screen.getByRole('link', { name: new RegExp(summary) })

afterEach(() => vi.unstubAllGlobals())

describe('NeedsYouPage', () => {
  it('lists needs-you entries with avatars and links', () => {
    renderPage(crewState({ bots: [bot({ name: 'dev', title: 'Dev' })], pending: [pending('a', 'dev', 'approval', 'run it', 5)] }))
    const link = linkOf('run it')
    expect(link).toHaveAttribute('href', '/bots/dev')
    expect(within(link).getByTestId('stub')).toHaveAttribute('data-size', '32')
    expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(within(link).getByText('Open chat')).toBeInTheDocument()
  })

  it('links each entry from its summary to the chat and answers from the card', async () => {
    const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response('{"status":"sent"}', { status: 202 })))
    vi.stubGlobal('fetch', fetchMock)
    const entry: PendingView = { ...pending('a 1', 'dev', 'approval', 'Delete files — rm -r /tmp/x', 5), choices: ['once', 'deny'], command: 'rm -r /tmp/x', description: 'Delete files' }
    renderPage(crewState({ bots: [bot({ name: 'dev', title: 'Dev' })], pending: [entry] }))
    const card = screen.getByTestId('request-card')
    const link = within(card).getByRole('link', { name: /Delete files — rm -r \/tmp\/x/ })
    expect(link).toHaveAttribute('href', '/bots/dev')
    expect(link).toHaveTextContent('Approval')
    expect(link).toHaveTextContent('just now')
    expect(link).toHaveTextContent('Open chat')
    // The whole command and the answer buttons sit in the card, outside the link.
    expect(within(card).getByTestId('approval-command').textContent).toBe('rm -r /tmp/x')
    const deny = within(card).getByRole('button', { name: 'Deny' })
    expect(link.contains(deny)).toBe(false)
    expect(within(card).getAllByRole('button').map(b => b.textContent)).toEqual(['Allow once', 'Deny'])
    fireEvent.click(deny)
    await flush()
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/crew/requests/a%201/answer')
    expect(JSON.parse(init!.body as string)).toEqual({ choice: 'deny' })
  })

  it('shows the count beside the heading and the oldest request first', () => {
    renderPage(crewState({
      bots: [bot({ name: 'dev', title: 'Dev' })],
      pending: [pending('new', 'dev', 'approval', 'newer one', 5), pending('old', 'dev', 'approval', 'older one', 500)]
    }))
    expect(screen.getByRole('heading', { name: 'Needs you' })).toBeInTheDocument()
    expect(screen.getByLabelText('2 open requests')).toHaveTextContent('2')
    expect(screen.getAllByRole('link').map(l => l.getAttribute('aria-label') ?? l.textContent)).toEqual([expect.stringContaining('older one'), expect.stringContaining('newer one')])
  })

  it('offers no allow choice for a truncated command on the page either', () => {
    const entry: PendingView = { ...pending('a', 'dev', 'approval', 's', 5), choices: ['once', 'session', 'deny'], command: 'x'.repeat(50), detailTruncated: true }
    renderPage(crewState({ bots: [bot({ name: 'dev', title: 'Dev' })], pending: [entry] }))
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Deny'])
  })

  it.each([
    ['Hermes offline', { hermes: 'offline' as const }, true],
    ['Crew stream down', {}, false]
  ])('hides live status on the rows while stale (%s)', (_label, over, connected) => {
    const bots = [bot({ name: 'dev', title: 'Dev', status: 'working' }), bot({ name: 'res', title: 'Res', status: 'needs_you' })]
    renderPage(crewState({ ...over, bots, pending: [pending('a', 'dev', 'approval', 'x', 5), pending('b', 'res', 'approval', 'y', 6)] }), connected)
    expect(screen.getAllByTestId('stub')).toHaveLength(2)
    for (const stub of screen.getAllByTestId('stub')) expect(stub).not.toHaveAttribute('data-state', 'working')
    expect(document.querySelector('.bg-status-waiting, .bg-status-working')).toBeNull()
  })

  it('shows live status on the rows while connected (control)', () => {
    const bots = [bot({ name: 'dev', title: 'Dev', status: 'working' }), bot({ name: 'res', title: 'Res', status: 'needs_you' })]
    renderPage(crewState({ bots, pending: [pending('a', 'dev', 'approval', 'x', 5), pending('b', 'res', 'approval', 'y', 6)] }))
    expect(within(linkOf('x')).getByTestId('stub')).toHaveAttribute('data-state', 'working')
    expect(linkOf('y').querySelector('.bg-status-waiting')).not.toBeNull()
  })

  it('lists entries across bots and links to the chat', () => {
    renderPage(crewState({
      bots: [bot({ name: 'researcher', title: 'Researcher' }), bot({ name: 'dev', title: 'Dev' })],
      pending: [
        pending('a', 'researcher', 'approval', 'send summary email', 125),
        pending('b', 'dev', 'secret', 'API key for X', 7200)
      ]
    }))
    expect(screen.getByText('Researcher')).toBeInTheDocument()
    expect(screen.getByText('Approval')).toBeInTheDocument()
    expect(screen.getByText('Secret')).toBeInTheDocument()
    expect(screen.getByText('2m ago')).toBeInTheDocument()
    expect(screen.getByText('2h ago')).toBeInTheDocument()
    expect(linkOf('send summary email')).toHaveAttribute('href', '/bots/researcher')
    expect(linkOf('API key for X')).toHaveAttribute('href', '/bots/dev')
  })

  it('truncates a long unbroken title and keeps the kind and age whole', () => {
    const long = 'x'.repeat(80)
    renderPage(crewState({ bots: [bot({ name: 'dev', title: long })], pending: [pending('a', 'dev', 'approval', 's', 125)] }))
    expect(screen.getByText(long)).toHaveClass('min-w-0', 'truncate')
    expect(screen.getByText('Approval')).toHaveClass('shrink-0')
    expect(screen.getByText('2m ago')).toHaveClass('shrink-0')
  })

  it('shows an empty state', () => {
    renderPage(crewState({ pending: [] }))
    expect(screen.getByText('Nothing needs you right now.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Needs you' })).toBeInTheDocument()
    expect(screen.queryByTestId('request-card')).toBeNull()
  })

  it('still lists a request whose bot is missing from the roster', () => {
    renderPage(crewState({ bots: [], pending: [pending('a', 'ghost', 'clarify', 'Which one?', 5)] }))
    expect(screen.getByText('ghost')).toBeInTheDocument()
    expect(screen.getByText('just now')).toBeInTheDocument()
  })

  it('links a group approval in Needs you to its group', () => {
    const entry: PendingView = { ...pending('g', 'dev', 'approval', 'run it', 5), source: 'group', group: { roomId: 'r 1', memberId: 'dev', taskId: 't', requestId: 'q' } }
    renderPage(crewState({
      bots: [bot({ name: 'dev', title: 'Dev' })],
      groups: { available: true, seatable: [], rooms: [group({ id: 'r 1', name: 'Launch' })] },
      pending: [entry]
    }))
    const link = screen.getByText('Dev in Launch').closest('a')!
    expect(link).toHaveAttribute('href', '/groups/r%201')
    expect(within(link).getByText('Open chat')).toBeInTheDocument()
  })
})
