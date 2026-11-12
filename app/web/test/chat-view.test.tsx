import { act, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MessageList } from '@/features/chat/MessageList'
import type { ChatItem } from '@/chat/types'
import type { BotView } from '@/state/types'

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
const { ChatSessionProvider } = await import('@/features/chat/chat-session-context')
/** The app opens the session above the shell; a lone ChatView gets the same provider for its own bot. */
const chat = (view: ReactElement<{ bot: BotView }>) => <ChatSessionProvider bot={view.props.bot}>{view}</ChatSessionProvider>
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
  it('renders user messages as raised bubbles and bot replies as prose', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u', text: 'hi there' },
      { kind: 'assistant', id: 'a', text: '[docs](https://example.com) and `code`' }
    ]
    render(<MessageList items={items} />)
    expect(screen.getByText('hi there')).toHaveClass('bg-raised', 'text-foreground', 'rounded-2xl')
    expect(screen.getByText('hi there').parentElement).toHaveClass('self-end')
    const reply = screen.getByText('docs').closest('div')!
    expect(reply.closest('.bg-raised')).toBeNull()
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('href', 'https://example.com')
    expect(screen.getByText('code').closest('code')).toBeInTheDocument()
  })
})

describe('MessageList: thread', () => {
  it('is a log named transcript, with notices as centered meta lines', () => {
    render(<MessageList items={[{ kind: 'notice', id: 'n', text: 'Stopped' }]} />)
    expect(screen.getByRole('log')).toBe(screen.getByTestId('transcript'))
    const notice = screen.getByText('Stopped')
    expect(notice).toHaveClass('text-center', 'text-xs')
    expect(notice.className).not.toMatch(/bg-/)
  })

  it('shows a run card for a turn with steps', () => {
    const items: ChatItem[] = [{ kind: 'work', id: 'w', steps: [{ id: 's', name: 'terminal', summary: 'ls', running: true }] }]
    render(<MessageList items={items} />)
    expect(screen.getByText('Working · 1 step')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('shows the Queued caption under a queued message', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u1', text: 'first' },
      { kind: 'user', id: 'u2', text: 'second', submissionId: 's2', queued: true }
    ]
    const { rerender } = render(<MessageList items={items} />)
    const caption = screen.getByText('Queued')
    expect(screen.getAllByText('Queued')).toHaveLength(1)
    expect(caption.parentElement).toContainElement(screen.getByText('second'))
    expect(caption).toHaveClass('text-faint')
    rerender(<MessageList items={[items[0]!, { kind: 'user', id: 'u2', text: 'second', submissionId: 's2' }]} />)
    expect(screen.queryByText('Queued')).toBeNull()
  })

  it('shows what it is given for an empty thread, and only while there is no item', () => {
    const { rerender } = render(<MessageList items={[]} empty={<p>Nothing yet</p>} />)
    expect(screen.getByText('Nothing yet')).toBeInTheDocument()
    rerender(<MessageList items={[{ kind: 'user', id: 'u', text: 'hi' }]} empty={<p>Nothing yet</p>} />)
    expect(screen.queryByText('Nothing yet')).toBeNull()
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
    render(chat(<ChatView bot={{ ...dev, status: 'working' }} state={crewState()} crewConnected />))
    await flush()
    expect(screen.getByText('earlier question')).toBeInTheDocument()
    expect(screen.getByText('answer').tagName).toBe('STRONG')
    expect(screen.getByRole('heading', { name: 'Dev' })).toBeInTheDocument()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(client.calls[0]).toMatchObject({ method: 'session.resume', params: { profile: 'dev', session_id: 'tip-1' } })
  })

  it('shows the Sandboxed badge in the chat header for on only', async () => {
    const { unmount } = render(chat(<ChatView bot={{ ...dev, sandbox: 'on' }} state={crewState()} crewConnected />))
    await flush()
    expect(screen.getByRole('img', { name: 'Sandboxed' })).toBeInTheDocument()
    unmount()
    for (const sandbox of ['partial', 'off'] as const) {
      const r = render(chat(<ChatView bot={{ ...dev, sandbox }} state={crewState()} crewConnected />))
      await flush()
      expect(screen.queryByRole('img', { name: 'Sandboxed' })).toBeNull()
      r.unmount()
    }
  })

  it('shows the status as a chip in the header, with a 32 px avatar', async () => {
    render(chat(<ChatView bot={{ ...dev, status: 'working' }} state={crewState()} crewConnected />))
    await flush()
    const chip = screen.getByText('Working')
    expect(chip).toHaveClass('rounded-full', 'bg-raised', 'text-xs')
    expect(chip.closest('header')).not.toBeNull()
    expect(within(screen.getByRole('banner')).getByTestId('stub')).toHaveAttribute('data-size', '32')
  })

  it('keeps the title heading inside a header and opens the profile from it', async () => {
    const onPanel = vi.fn()
    render(chat(<ChatView bot={{ ...dev, sandbox: 'on' }} state={crewState()} crewConnected onPanel={onPanel} />))
    await flush()
    const heading = screen.getByRole('heading', { name: 'Dev', level: 2 })
    const header = heading.closest('header')!
    expect(header).not.toBeNull()
    expect(within(header).getByRole('img', { name: 'Sandboxed' })).toBeInTheDocument()
    fireEvent.click(within(heading).getByRole('button', { name: 'Dev' }))
    expect(onPanel).toHaveBeenLastCalledWith('profile')
  })

  it('shows the title as plain text when there is no panel to open', async () => {
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
    await flush()
    expect(within(screen.getByRole('heading', { name: 'Dev' })).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Profile' })).toBeNull()
  })

  it('shows role, short model and cost in the meta line', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ messages: [], estimated_cost_usd: 0.123 })))))
    render(chat(<ChatView bot={{ ...dev, role: 'engineer', model: 'anthropic/claude-haiku-5.5' }} state={crewState()} crewConnected />))
    await flush()
    const meta = await screen.findByText('Engineer · claude-haiku-5.5 · ≈ $0.12')
    expect(meta.closest('header')).not.toBeNull()
    expect(meta).toHaveClass('truncate', 'text-xs')
  })

  it('leaves the meta line out when the bot has no role, model or cost', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ messages: [] })))))
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
    await flush()
    expect(screen.getByRole('banner').querySelector('p')).toBeNull()
  })

  it('shows the empty thread with Set up profile, or Finish setup for an unfinished bot', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ messages: [] })))))
    const onPanel = vi.fn()
    const first = render(chat(<ChatView bot={dev} state={crewState()} crewConnected onPanel={onPanel} />))
    await flush()
    const transcript = screen.getByTestId('transcript')
    expect(within(transcript).getByText('Start with Dev')).toBeInTheDocument()
    expect(within(transcript).queryByRole('button', { name: 'Finish setup' })).toBeNull()
    fireEvent.click(within(transcript).getByRole('button', { name: 'Set up profile' }))
    expect(onPanel).toHaveBeenLastCalledWith('profile')
    first.unmount()

    render(chat(<ChatView bot={{ ...dev, setupIncomplete: true }} state={crewState()} crewConnected onPanel={onPanel} />))
    await flush()
    expect(screen.queryByRole('button', { name: 'Set up profile' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(onPanel).toHaveBeenCalledTimes(2)
  })

  it('shows no empty thread before the chat has loaded, or once it has messages', async () => {
    const { unmount } = render(<ChatSessionProvider bot={bot({ name: 'researcher', title: 'Researcher' })}><ChatView bot={dev} state={crewState()} crewConnected /></ChatSessionProvider>)
    await flush()
    expect(screen.queryByText('Start with Dev')).toBeNull()
    unmount()
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
    await flush()
    expect(screen.getByText('earlier question')).toBeInTheDocument()
    expect(screen.queryByText('Start with Dev')).toBeNull()
  })

  it('shows the Queued caption on a message Hermes queued, until the next turn starts', async () => {
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
    await flush()
    client.handlers['prompt.submit'] = () => ({ status: 'queued' })
    act(() => { client.emit({ type: 'message.start', session_id: 'live-1', payload: {}, execution_generation: 2 }) })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next thing' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await flush()
    expect(screen.getByText('Queued')).toBeInTheDocument()
    act(() => {
      client.emit({ type: 'message.complete', session_id: 'live-1', payload: { text: 'done', status: 'complete' }, execution_generation: 2 })
      client.emit({ type: 'message.start', session_id: 'live-1', payload: {}, execution_generation: 3 })
    })
    expect(screen.queryByText('Queued')).toBeNull()
    expect(screen.getByText('next thing')).toBeInTheDocument()
  })

  it('tells the composer drawer about a queued message, an open request, and a disabled reason, in that order', async () => {
    const request = { id: 'p1', kind: 'approval' as const, profile: 'dev', sessionId: 's', summary: 'cmd', choices: ['once', 'deny'], receivedAt: 1, source: 'event' as const, state: 'open' as const, answerable: true }
    const { rerender } = render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
    await flush()
    const drawer = () => screen.queryByText(/Queued\. It goes in|Waiting for you above|Hermes is offline/)
    expect(drawer()).toBeNull()
    client.handlers['prompt.submit'] = () => ({ status: 'queued' })
    act(() => { client.emit({ type: 'message.start', session_id: 'live-1', payload: {}, execution_generation: 2 }) })
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'next thing' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await flush()
    expect(drawer()).toHaveTextContent('Queued. It goes in after the current turn.')
    expect(drawer()).toHaveAttribute('role', 'status')
    // The turn is running in this session, so Stop is offered by name.
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    rerender(chat(<ChatView bot={dev} state={crewState({ pending: [request] })} crewConnected />))
    expect(drawer()).toHaveTextContent('Waiting for you above')
    // A request for another bot is not above this composer.
    rerender(chat(<ChatView bot={dev} state={crewState({ pending: [{ ...request, profile: 'researcher' }] })} crewConnected />))
    expect(drawer()).toHaveTextContent('Queued. It goes in after the current turn.')
    rerender(chat(<ChatView bot={dev} state={crewState({ hermes: 'offline', pending: [request] })} crewConnected />))
    expect(drawer()).toHaveTextContent('Hermes is offline')
  })

  it.each([
    ['Hermes offline', { hermes: 'offline' as const }, true],
    ['Crew stream down', {}, false]
  ])('hides live status in the header while stale (%s)', async (_label, over, connected) => {
    for (const status of ['working', 'needs_you'] as const) {
      const { unmount } = render(chat(<ChatView bot={{ ...dev, status }} state={crewState(over)} crewConnected={connected} />))
      await flush()
      expect(screen.queryByText(/^(Working|Needs you)$/)).toBeNull()
      expect(screen.getByTestId('stub')).not.toHaveAttribute('data-state', 'working')
      expect(screen.queryByRole('img', { name: 'Needs you', hidden: true })).toBeNull()
      unmount()
    }
  })

  it('shows Computer, Routines and Profile as icon buttons, pressed for the open panel, and hides the avatar from assistive tech', async () => {
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected panel="routines" onPanel={() => undefined} />))
    await flush()
    const header = screen.getByRole('banner')
    for (const name of ['Computer', 'Routines', 'Profile']) {
      const button = within(header).getByRole('button', { name })
      expect(button, name).toHaveTextContent('')
      expect(button, name).toHaveAttribute('aria-pressed', name === 'Routines' ? 'true' : 'false')
    }
    expect(within(header).getByRole('button', { name: 'Routines' })).toHaveClass('bg-raised', 'text-foreground')
    expect(within(header).getByTestId('stub').closest('[aria-hidden="true"]')).not.toBeNull()
  })

  it('reports a header button as the next panel, and null for the open one', async () => {
    const onPanel = vi.fn()
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected panel="routines" onPanel={onPanel} />))
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Computer' }))
    expect(onPanel).toHaveBeenLastCalledWith('computer')
    fireEvent.click(screen.getByRole('button', { name: 'Routines' }))
    expect(onPanel).toHaveBeenLastCalledWith(null)
    fireEvent.click(screen.getByRole('button', { name: 'Profile' }))
    expect(onPanel).toHaveBeenLastCalledWith('profile')
  })

  it('shows an empty, unsendable chat while the open session belongs to another bot', async () => {
    render(<ChatSessionProvider bot={bot({ name: 'researcher', title: 'Researcher' })}><ChatView bot={dev} state={crewState()} crewConnected /></ChatSessionProvider>)
    await flush()
    expect(screen.queryByText('earlier question')).toBeNull()
    expect(screen.getByRole('textbox')).toBeDisabled()
    expect(screen.getByText('Connecting to the chat…')).toBeInTheDocument()
  })

  it('gives the title the room: it truncates last, and the controls never shrink', async () => {
    render(chat(<ChatView bot={{ ...dev, status: 'working' }} state={crewState()} crewConnected onPanel={() => undefined} />))
    await flush()
    const heading = screen.getByRole('heading', { name: 'Dev' })
    expect(heading.closest('.flex-1')).toHaveClass('min-w-24', 'flex-1')
    expect(within(heading).getByRole('button')).toHaveClass('truncate')
    expect(screen.getByText('Working')).toHaveClass('shrink-0')
  })

  it('keeps header and composer outside the scrolling transcript', async () => {
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
    await flush()
    const transcript = screen.getByTestId('transcript')
    expect(transcript.contains(screen.getByRole('textbox'))).toBe(false)
    expect(transcript.contains(screen.getByRole('heading', { name: 'Dev' }))).toBe(false)
  })

  it('pins this bot\u2019s requests above the composer, outside the transcript, oldest first, and answers through Crew', async () => {
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => Promise.resolve(new Response(String(url).includes('/answer') ? '{"status":"sent"}' : JSON.stringify({ messages: [] }), { status: url.includes('/answer') ? 202 : 200 })))
    vi.stubGlobal('fetch', fetchMock)
    const mk = (id: string, profile: string, receivedAt: number) => ({ id, kind: 'approval' as const, profile, sessionId: 's', summary: `cmd ${id}`, choices: ['once', 'deny'], receivedAt, source: 'event' as const, state: 'open' as const, answerable: true })
    render(chat(<ChatView bot={dev} state={crewState({ pending: [mk('late', 'dev', 20), mk('other', 'researcher', 5), mk('early', 'dev', 10)] })} crewConnected />))
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

  it('does not show group approvals in the bot chat', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify({ messages: [] }), { status: 200 }))))
    const grp = { id: 'group:r1:q', kind: 'approval' as const, profile: 'dev', sessionId: 's', summary: 'group cmd', choices: ['once', 'deny'], receivedAt: 1, source: 'group' as const, state: 'open' as const, answerable: true, group: { roomId: 'r1', memberId: 'dev', taskId: 't', requestId: 'q' } }
    render(chat(<ChatView bot={dev} state={crewState({ pending: [grp] })} crewConnected />))
    await flush()
    expect(screen.queryByTestId('request-card')).toBeNull()
    expect(screen.queryByText('group cmd')).toBeNull()
  })

  it('sends from the composer and shows the message', async () => {
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
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
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
    await flush()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'ping' } })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    await flush()
    expect(screen.getByText('Not sent: session_busy')).toBeInTheDocument()
  })

  it('disables the composer while Hermes is offline', async () => {
    render(chat(<ChatView bot={dev} state={crewState({ hermes: 'offline' })} crewConnected />))
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
    render(chat(<ChatView bot={dev} state={state} crewConnected />))
    await flush()
    expect(screen.getByText('2 bots are working — wait, stop one, or raise the limit in Settings')).toBeInTheDocument()
  })

  it('shows the live reply, a Stop button while running, and interrupts with the generation', async () => {
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
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
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
    await flush()
    act(() => { client.emit({ type: 'message.start', session_id: 'live-1', payload: {}, execution_generation: 2 }) })
    expect(screen.getByRole('button', { name: 'Stop' })).toBeEnabled()
    act(() => client.setState('closed'))
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
  })

  it('shows a Stop failure in the transcript', async () => {
    client.handlers['session.interrupt'] = () => { throw new JsonRpcGatewayError('session_busy', { code: -32000 }) }
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
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
    render(chat(<ChatView bot={dev} state={crewState()} crewConnected />))
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
