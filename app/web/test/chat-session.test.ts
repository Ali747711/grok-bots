import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatSession } from '@/chat/chat-session'
import type { ChatItem } from '@/chat/types'

import { FakeClient } from './fake-client'
import { bot } from './fixtures'

const SID = 'live-1'
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
const texts = (items: readonly ChatItem[]) => items.map(i => (i.kind === 'work' ? `work:${i.steps.length}` : `${i.kind}:${i.text}`))

const historyBody = (rows: unknown[]) => new Response(JSON.stringify({ messages: rows }), { status: 200 })
const row = (id: number, role: string, content: string) => ({ id, role, content })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(() => Promise.resolve(historyBody([row(1, 'user', 'earlier question'), row(2, 'assistant', 'earlier answer')])))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function setup(resume: Record<string, unknown> = {}, name = 'default') {
  const client = new FakeClient()
  client.handlers['session.resume'] = () => ({ session_id: SID, execution_generation: 3, running: false, ...resume })
  client.handlers['prompt.submit'] = () => ({ status: 'started' })
  const session = new ChatSession(client, bot({ name, sessionId: 'tip-1' }))
  return { client, session }
}

const frame = (type: string, payload: unknown, extra: Record<string, unknown> = {}) => ({ type, session_id: SID, payload, execution_generation: 4, ...extra })

describe('ChatSession', () => {
  it('loads history through the proxy after resuming and exposes it', async () => {
    const { session } = setup()
    await session.open()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(`/api/sessions/${SID}/messages?profile=default&limit=120&order=latest&include_compacted=true`)
    expect(texts(session.items)).toEqual(['user:earlier question', 'assistant:earlier answer'])
    expect(session.sessionId).toBe(SID)
    expect(session.canSend).toBe(true)
  })

  it('applies live frames on top of history', async () => {
    const { client, session } = setup()
    await session.open()
    const seen: number[] = []
    session.subscribe(items => seen.push(items.length))
    client.emit(frame('message.start', {}))
    client.emit(frame('message.delta', { text: 'Hi', turn_id: 't', segment: 0, offset: 0 }))
    expect(texts(session.items).at(-1)).toBe('assistant:Hi')
    expect(session.running).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
  })

  it('starts running when the snapshot says a turn is in flight', async () => {
    const { session } = setup({ running: true })
    await session.open()
    expect(session.running).toBe(true)
  })

  it('sends with profile, a uuid submission id, surface hud and the long timeout', async () => {
    const { client, session } = setup()
    await session.open()
    expect(await session.send('hello')).toBe('started')
    const call = client.callsOf('prompt.submit')[0]!
    expect(call.params).toMatchObject({ profile: 'default', session_id: SID, text: 'hello', surface: 'hud' })
    expect(call.params.submission_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(call.timeoutMs).toBe(1_800_000)
    const last = session.items.at(-1)!
    expect(last).toMatchObject({ kind: 'user', text: 'hello', id: `user-${call.params.submission_id}` })
  })

  it('maps admission terminal to duplicate (removing the local copy) and unknown to lost (with a notice)', async () => {
    const { client, session } = setup()
    await session.open()
    client.handlers['prompt.submit'] = () => ({ status: 'terminal' })
    expect(await session.send('again')).toBe('duplicate')
    expect(texts(session.items)).not.toContain('user:again')
    client.handlers['prompt.submit'] = () => ({ status: 'unknown' })
    expect(await session.send('maybe')).toBe('lost')
    expect(texts(session.items)).toContain('user:maybe')
    expect(texts(session.items).at(-1)).toBe('notice:This message was lost when Hermes restarted')
  })

  it('keeps queued admissions', async () => {
    const { client, session } = setup()
    await session.open()
    client.handlers['prompt.submit'] = () => ({ status: 'queued' })
    expect(await session.send('later')).toBe('queued')
    expect(texts(session.items)).toContain('user:later')
  })

  it('replaces the local message with a notice when the submit is rejected', async () => {
    const { client, session } = setup()
    await session.open()
    client.handlers['prompt.submit'] = () => { throw new Error('session_busy') }
    await expect(session.send('nope')).rejects.toThrow('session_busy')
    expect(texts(session.items)).not.toContain('user:nope')
    expect(texts(session.items).at(-1)).toBe('notice:Not sent: session_busy')
  })

  it('keeps earlier turns above a new user message', async () => {
    const { client, session } = setup()
    await session.open()
    client.emit(frame('message.start', {}))
    client.emit(frame('message.delta', { text: 'Answer', turn_id: 't', segment: 0, offset: 0 }))
    client.emit(frame('message.complete', { text: 'Answer', status: 'complete' }))
    await session.send('next')
    expect(texts(session.items).slice(-2)).toEqual(['assistant:Answer', 'user:next'])
  })

  it('stops with the highest generation seen (snapshot, frames, session.info), ignoring other sessions', async () => {
    const { client, session } = setup()
    await session.open()
    client.emit(frame('message.start', {}, { execution_generation: 5 }))
    client.emit(frame('session.info', { execution_generation: 7 }, { execution_generation: undefined }))
    client.emit({ type: 'message.start', session_id: 'other', payload: {}, execution_generation: 99 })
    await session.stop()
    expect(client.callsOf('session.interrupt')[0]?.params).toEqual({ profile: 'default', session_id: SID, execution_generation: 7 })
  })

  it('blocks sending while disconnected and re-resumes after reconnect before allowing send', async () => {
    const { client, session } = setup()
    await session.open()
    expect(client.callsOf('session.resume')).toHaveLength(1)
    client.setState('closed')
    expect(session.canSend).toBe(false)
    await expect(session.send('x')).rejects.toThrow()

    let release: (v: unknown) => void = () => undefined
    client.handlers['session.resume'] = () => new Promise(resolve => { release = resolve })
    client.setState('open')
    expect(client.callsOf('session.resume')).toHaveLength(2)
    expect(session.canSend).toBe(false)
    release({ session_id: 'live-2', execution_generation: 6, running: false })
    await flush()
    expect(session.canSend).toBe(true)
    expect(session.sessionId).toBe('live-2')
  })

  it('routes events by the returned session id, so another bot never sees them', async () => {
    const client = new FakeClient()
    client.handlers['session.resume'] = params => ({ session_id: params.profile === 'a' ? 'sess-a' : 'sess-b', execution_generation: 1, running: false })
    const a = new ChatSession(client, bot({ name: 'a', sessionId: 'tip-a' }))
    const b = new ChatSession(client, bot({ name: 'b', sessionId: 'tip-b' }))
    await Promise.all([a.open(), b.open()])
    client.emit({ type: 'message.start', session_id: 'sess-b', payload: {}, execution_generation: 2 })
    client.emit({ type: 'message.delta', session_id: 'sess-b', payload: { text: 'for b', turn_id: 't', segment: 0, offset: 0 }, execution_generation: 2 })
    expect(texts(b.items).at(-1)).toBe('assistant:for b')
    expect(texts(a.items).join()).not.toContain('for b')
    expect(a.running).toBe(false)
  })

  it('stops listening after close()', async () => {
    const { client, session } = setup()
    await session.open()
    session.close()
    client.emit(frame('message.start', {}))
    expect(session.running).toBe(false)
  })
})
