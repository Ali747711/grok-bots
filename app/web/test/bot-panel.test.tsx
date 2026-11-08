import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CrewState } from '@/state/types'

import { FakeClient } from './fake-client'
import { bot, crewState } from './fixtures'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))
const hook = vi.hoisted(() => ({ value: { state: null as CrewState | null, connected: true } }))
vi.mock('@/state/use-crew-state', () => ({ useCrewState: () => hook.value }))

const { default: App } = await import('@/App')
const { BotPanel } = await import('@/features/panel/BotPanel')

beforeEach(() => {
  hook.value = { state: crewState(), connected: true }
  client.handlers = { 'session.resume': () => ({ session_id: 'live-1', execution_generation: 1, running: false }) }
  vi.stubGlobal('fetch', vi.fn((url: string) =>
    Promise.resolve(new Response(JSON.stringify(url.startsWith('/crew/bots/') && !url.endsWith('/finish')
      ? { name: url.slice('/crew/bots/'.length), isPrimary: false, title: url.endsWith('researcher') ? 'Researcher' : 'Dev', look: { shape: null, color: null, imageKind: null }, hidden: false, description: 'd', soul: 's', model: null, metaRevision: 1 }
      : { messages: [] })))))
})
afterEach(() => vi.unstubAllGlobals())

const renderAt = (path: string) => render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>)

describe('BotPanel', () => {
  it('shows the routines placeholder and the profile tab', async () => {
    const { rerender } = render(<MemoryRouter><BotPanel bot={bot({ name: 'dev', title: 'Dev' })} tab="routines" /></MemoryRouter>)
    expect(screen.getByRole('button', { name: 'New routine' })).toBeInTheDocument()
    rerender(<MemoryRouter><BotPanel bot={bot({ name: 'dev', title: 'Dev' })} tab="profile" /></MemoryRouter>)
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
  })
})

describe('panel in the app', () => {
  it('opens from the header buttons and closes by clicking again', async () => {
    renderAt('/bots/dev')
    await screen.findByRole('heading', { name: 'Dev' })
    expect(screen.queryByRole('region', { name: 'Panel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(screen.queryByRole('region', { name: 'Panel' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Routines' }))
    expect(screen.getByRole('button', { name: 'New routine' })).toBeInTheDocument()
  })

  it('survives a reload: ?panel=profile opens the panel', async () => {
    renderAt('/bots/dev?panel=profile')
    expect(await screen.findByLabelText('Name')).toBeInTheDocument()
  })

  it('keeps the panel open when another bot is selected', async () => {
    renderAt('/bots/dev?panel=profile')
    await screen.findByDisplayValue('Dev')
    fireEvent.click(screen.getByRole('button', { name: /Researcher/ }))
    expect(await screen.findByDisplayValue('Researcher')).toBeInTheDocument()
  })

  it('ignores an unknown panel value', async () => {
    renderAt('/bots/dev?panel=nope')
    await screen.findByRole('heading', { name: 'Dev' })
    expect(screen.queryByRole('region', { name: 'Panel' })).toBeNull()
  })
})
