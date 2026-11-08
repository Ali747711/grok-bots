import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CrewState } from '@/state/types'

import { FakeClient } from './fake-client'
import { crewState } from './fixtures'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))
const hook = vi.hoisted(() => ({ value: { state: null as CrewState | null, connected: true } }))
vi.mock('@/state/use-crew-state', () => ({ useCrewState: () => hook.value }))

const { default: App } = await import('@/App')

beforeEach(() => {
  hook.value = { state: crewState(), connected: true }
  client.handlers = { 'session.resume': () => ({ session_id: 'live-1', execution_generation: 1, running: false }) }
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ messages: [] }), { status: 200 }))))
})

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

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
