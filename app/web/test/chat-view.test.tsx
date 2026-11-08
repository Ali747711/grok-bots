import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageList } from '@/features/chat/MessageList'
import type { ChatItem } from '@/chat/types'

import { JsonRpcGatewayError } from '@/vendor/hermes/json-rpc-channel'

import { FakeClient } from './fake-client'
import { bot, crewState } from './fixtures'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-size={String(props.size)} data-state={String(props.state)} /> }
})

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

describe('MessageList: look', () => {
  it('renders user messages as contrast bubbles and bot replies as prose', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u', text: 'hi there' },
      { kind: 'assistant', id: 'a', text: '[docs](https://example.com) and `code`' }
    ]
    render(<MessageList items={items} />)
    expect(screen.getByText('hi there')).toHaveClass('bg-contrast', 'text-contrast-foreground', 'rounded-[16px_16px_4px_16px]')
    const reply = screen.getByText('docs').closest('div')!
    expect(reply.closest('.bg-contrast')).toBeNull()
    expect(screen.getByText('docs')).toHaveClass('text-sky-ink')
    expect(screen.getByText('code').closest('code')).toBeInTheDocument()
  })
})

describe('MessageList: delivery state', () => {
  it('shows checking, and Not sent with its reason and a working Retry', () => {
    const onRetry = vi.fn()
    const items: ChatItem[] = [
      { kind: 'user', id: 'u1', text: 'one', submissionId: 's1', delivery: 'checking' },
      { kind: 'user', id: 'u2', text: 'two', submissionId: 's2', delivery: 'not_sent', reason: 'Not sent: session busy' }
    ]
    render(<MessageList items={items} onRetry={onRetry} />)
    expect(screen.getByText('Delivery uncertain — checking…')).toBeInTheDocument()
    expect(screen.getByText(/Not sent: session busy/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledWith('s2')
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

  it('shows the working status in sky in the header, with a 40 px avatar', async () => {
    render(<ChatView bot={{ ...dev, status: 'working' }} state={crewState()} crewConnected />)
    await flush()
    expect(screen.getByText('Working')).toHaveClass('text-sky-ink', 'label-mono')
    expect(screen.getByTestId('stub')).toHaveAttribute('data-size', '40')
  })

  it.each([
    ['Hermes offline', { hermes: 'offline' as const }, true],
    ['Crew stream down', {}, false]
  ])('hides live status in the header while stale (%s)', async (_label, over, connected) => {
    for (const status of ['working', 'needs_you'] as const) {
      const { unmount } = render(<ChatView bot={{ ...dev, status }} state={crewState(over)} crewConnected={connected} />)
      await flush()
      expect(screen.queryByText(/^(Working|Needs you)$/)).toBeNull()
      expect(screen.getByTestId('stub')).not.toHaveAttribute('data-state', 'working')
      expect(screen.queryByRole('img', { name: 'Needs you', hidden: true })).toBeNull()
      unmount()
    }
  })

  it('marks the pressed panel button with the foreground fill and hides the avatar from assistive tech', async () => {
    render(<ChatView bot={dev} state={crewState()} crewConnected panel="routines" onPanel={() => undefined} />)
    await flush()
    expect(screen.getByRole('button', { name: 'Routines' })).toHaveClass('bg-foreground', 'text-background')
    expect(screen.getByRole('button', { name: 'Routines' }).className).not.toMatch(/dark:bg-input|bg-primary/)
    expect(screen.getByRole('button', { name: 'Profile' })).not.toHaveClass('bg-foreground')
    expect(screen.getByTestId('stub').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('keeps header and composer outside the scrolling transcript', async () => {
    render(<ChatView bot={dev} state={crewState()} crewConnected />)
    await flush()
    const transcript = screen.getByTestId('transcript')
    expect(transcript.contains(screen.getByRole('textbox'))).toBe(false)
    expect(transcript.contains(screen.getByRole('heading', { name: 'Dev' }))).toBe(false)
  })

  it('pins this bot\u2019s requests above the composer, outside the transcript, oldest first, and answers through Crew', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => Promise.resolve(new Response(String(url).includes('/answer') ? '{"status":"sent"}' : JSON.stringify({ messages: [] }), { status: url.includes('/answer') ? 202 : 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const mk = (id: string, profile: string, receivedAt: number) => ({ id, kind: 'approval' as const, profile, sessionId: 's', summary: `cmd ${id}`, choices: ['once', 'deny'], receivedAt, source: 'event' as const, state: 'open' as const, answerable: true })
    render(<ChatView bot={dev} state={crewState({ pending: [mk('late', 'dev', 20), mk('other', 'researcher', 5), mk('early', 'dev', 10)] })} crewConnected />)
    await flush()
    const cards = screen.getAllByTestId('request-card')
    expect(cards.map(c => c.textContent)).toEqual([expect.stringContaining('cmd early'), expect.stringContaining('cmd late')])
    const transcript = screen.getByTestId('transcript')
    for (const c of cards) expect(transcript.contains(c)).toBe(false)
    fireEvent.click(screen.getAllByRole('button', { name: 'Allow once' })[0]!)
    await flush()
    const call = fetchMock.mock.calls.find(c => String(c[0]).includes('/answer'))!
    expect(call[0]).toBe('/crew/requests/early/answer')
    expect((call[1] as RequestInit).method).toBe('POST')
    expect(JSON.parse((call[1] as RequestInit).body as string)).toEqual({ choice: 'once' })
  })

  it('sends from the composer and shows the message', async () => {
    render(<ChatView bot={dev} state={crewState()} crewConnected />)
    await flush()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ping' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await flush()
    expect(client.calls.find(c => c.method === 'prompt.submit')?.params).toMatchObject({ profile: 'dev', text: 'ping' })
    expect(client.calls.find(c => c.method === 'prompt.submit')?.params).not.toHaveProperty('surface')
    expect(screen.getByText('ping')).toBeInTheDocument()
  })

  it('swallows a rejected send (the notice is already in the list)', async () => {
    client.handlers['prompt.submit'] = () => { throw new JsonRpcGatewayError('session_busy', { code: -32000 }) }
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
    expect(screen.getByText('2 bots are working — wait, stop one, or raise the limit in Settings')).toBeInTheDocument()
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

  it('disables Stop while disconnected', async () => {
    render(<ChatView bot={dev} state={crewState()} crewConnected />)
    await flush()
    act(() => { client.emit({ type: 'message.start', session_id: 'live-1', payload: {}, execution_generation: 2 }) })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    act(() => client.setState('closed'))
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })

  it('shows a Stop failure in the transcript', async () => {
    client.handlers['session.interrupt'] = () => { throw new JsonRpcGatewayError('session_busy', { code: -32000 }) }
    render(<ChatView bot={dev} state={crewState()} crewConnected />)
    await flush()
    act(() => { client.emit({ type: 'message.start', session_id: 'live-1', payload: {}, execution_generation: 2 }) })
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    await flush()
    expect(screen.getByText('Couldn’t stop — session busy')).toBeInTheDocument()
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
