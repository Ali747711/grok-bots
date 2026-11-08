import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageList } from '@/features/chat/MessageList'
import type { ChatItem } from '@/chat/types'

import { FakeClient } from './fake-client'
import { bot, crewState } from './fixtures'

const client = new FakeClient()
vi.mock('@/chat/gateway', () => ({ connectGateway: () => client }))

const { ChatView } = await import('@/features/chat/ChatView')
const flush = () => act(() => new Promise<void>(resolve => setTimeout(resolve, 0)))

beforeEach(() => {
  client.calls = []
  client.handlers = {
    'session.resume': () => ({ session_id: 'live-1', execution_generation: 1, running: false }),
    'prompt.submit': () => ({ status: 'started' })
  }
  client.setState('open')
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ messages: [
    { id: 1, role: 'user', content: 'earlier question' },
    { id: 2, role: 'assistant', content: 'earlier **answer**' }
  ] }), { status: 200 }))))
})
afterEach(() => vi.unstubAllGlobals())

const dev = bot({ name: 'dev', title: 'Dev', sessionId: 'tip-1' })

describe('MessageList', () => {
  it('renders user, assistant and notice items and hides empty work blocks', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u', text: 'hi there' },
      { kind: 'work', id: 'w', steps: [] },
      { kind: 'assistant', id: 'a', text: 'hello **world**' },
      { kind: 'notice', id: 'n', text: 'Stopped' }
    ]
    render(<MessageList items={items} />)
    expect(screen.getByText('hi there')).toBeInTheDocument()
    expect(screen.getByText('world').tagName).toBe('STRONG')
    expect(screen.getByText('Stopped')).toBeInTheDocument()
    expect(screen.queryByText(/Worked/)).toBeNull()
  })
})

describe('ChatView', () => {
  it('opens the chat, shows history and the header status', async () => {
    render(<ChatView bot={{ ...dev, status: 'working' }} state={crewState()} crewConnected />)
    await flush()
    expect(screen.getByText('earlier question')).toBeInTheDocument()
    expect(screen.getByText('answer').tagName).toBe('STRONG')
    expect(screen.getByRole('heading', { name: 'Dev' })).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(client.calls[0]).toMatchObject({ method: 'session.resume', params: { profile: 'dev', session_id: 'tip-1' } })
  })

  it('sends from the composer and shows the message', async () => {
    render(<ChatView bot={dev} state={crewState()} crewConnected />)
    await flush()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ping' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await flush()
    expect(client.calls.find(c => c.method === 'prompt.submit')?.params).toMatchObject({ profile: 'dev', text: 'ping', surface: 'hud' })
    expect(screen.getByText('ping')).toBeInTheDocument()
  })

  it('swallows a rejected send (the notice is already in the list)', async () => {
    client.handlers['prompt.submit'] = () => { throw new Error('session_busy') }
    render(<ChatView bot={dev} state={crewState()} crewConnected />)
    await flush()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ping' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await flush()
    expect(screen.getByText('Not sent: session_busy')).toBeInTheDocument()
  })

  it('disables the composer while Hermes is offline', async () => {
    render(<ChatView bot={dev} state={crewState({ hermes: 'offline' })} crewConnected />)
    await flush()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByText('Hermes is offline')).toBeInTheDocument()
  })

  it('disables the composer while two other bots are working', async () => {
    const state = crewState({ bots: [
      bot({ name: 'dev', title: 'Dev' }),
      bot({ name: 'a', title: 'A', status: 'working' }),
      bot({ name: 'b', title: 'B', status: 'working' })
    ] })
    render(<ChatView bot={dev} state={state} crewConnected />)
    await flush()
    expect(screen.getByText('2 bots are working — wait or stop one')).toBeInTheDocument()
  })

  it('shows the live reply, a Stop button while running, and interrupts with the generation', async () => {
    render(<ChatView bot={dev} state={crewState()} crewConnected />)
    await flush()
    const f = (type: string, payload: unknown) => ({ type, session_id: 'live-1', payload, execution_generation: 2 })
    act(() => {
      client.emit(f('message.start', {}))
      client.emit(f('message.delta', { text: 'Working on it', turn_id: 't', segment: 0, offset: 0 }))
    })
    expect(screen.getByText('Working on it')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await flush()
    expect(client.calls.find(c => c.method === 'session.interrupt')?.params).toEqual({ profile: 'dev', session_id: 'live-1', execution_generation: 2 })
  })

  it('retries when the first open fails while connected and says so', async () => {
    let attempts = 0
    client.handlers['session.resume'] = () => {
      attempts += 1
      if (attempts === 1) throw new Error('boom')
      return { session_id: 'live-1', execution_generation: 1, running: false }
    }
    vi.useFakeTimers()
    render(<ChatView bot={dev} state={crewState()} crewConnected />)
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(screen.getByText('Couldn’t open the chat — retrying…')).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(1100) })
    vi.useRealTimers()
    await flush()
    expect(attempts).toBe(2)
    expect(screen.queryByText('Couldn’t open the chat — retrying…')).toBeNull()
    expect(screen.getByText('earlier question')).toBeInTheDocument()
  })
})
