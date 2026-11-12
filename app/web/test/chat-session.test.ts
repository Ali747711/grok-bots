import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatSession, type ChatClient } from '@/chat/chat-session'
import type { ChatItem } from '@/chat/types'
import { JsonRpcGatewayError } from '@/vendor/hermes/json-rpc-channel'
import type { JsonRpcGatewayClient } from '@/vendor/hermes/json-rpc-gateway'

import { FakeClient } from './fake-client'
import { bot } from './fixtures'

// Compile-time proof the real vendored client satisfies what ChatSession needs.
export const realClientFits = (client: JsonRpcGatewayClient): ChatClient => client

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
  const session = new ChatSession(client, bot({ name, sessionId: 'tip-1' }), { retryDelayMs: () => 0 })
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

  it('sends with profile, a uuid submission id, no surface (plain app window) and the long timeout', async () => {
    const { client, session } = setup()
    await session.open()
    expect(await session.send('hello')).toBe('started')
    const call = client.callsOf('prompt.submit')[0]!
    expect(call.params).toMatchObject({ profile: 'default', session_id: SID, text: 'hello' })
    expect(call.params).not.toHaveProperty('surface')
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

  it('marks a queued submission and clears it when the next turn starts', async () => {
    const { client, session } = setup()
    await session.open()
    const queued = () => session.items.filter(i => i.kind === 'user' && i.queued).map(i => (i as { text: string }).text)
    client.emit(frame('message.start', {}))
    client.handlers['prompt.submit'] = () => ({ status: 'queued' })
    await session.send('later')
    await session.send('and then')
    expect(queued()).toEqual(['later', 'and then'])
    // The running turn's own frames and its end leave the caption alone.
    client.emit(frame('message.delta', { text: 'One', turn_id: 't', segment: 0, offset: 0 }))
    client.emit(frame('message.complete', { text: 'One', status: 'complete' }))
    expect(queued()).toEqual(['later', 'and then'])
    client.emit(frame('message.start', {}, { execution_generation: 5 }))
    expect(queued()).toEqual([])
    expect(texts(session.items)).toEqual(expect.arrayContaining(['user:later', 'user:and then']))
    expect(session.items.some(i => 'queued' in i)).toBe(false)
  })

  it('does not mark a submission that started at once', async () => {
    const { session } = setup()
    await session.open()
    await session.send('now')
    expect(session.items.some(i => i.kind === 'user' && i.queued)).toBe(false)
  })

  it('replaces the local message with a notice when the submit is rejected', async () => {
    const { client, session } = setup()
    await session.open()
    client.handlers['prompt.submit'] = () => { throw new JsonRpcGatewayError('session_busy', { code: -32000 }) }
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

  describe('while a turn is running', () => {
    const delta = (text: string, offset: number) => frame('message.delta', { text, turn_id: 't', segment: 0, offset })
    const tool = frame('tool.start', { tool_id: 'tool-1', name: 'terminal', context: 'ls' })
    const ids = (items: readonly ChatItem[]) => items.map(i => i.id)

    it('keeps one reply when a message is sent mid-turn and places it after the turn', async () => {
      const { client, session } = setup()
      await session.open()
      client.handlers['prompt.submit'] = () => ({ status: 'queued' })
      client.emit(frame('message.start', {}))
      client.emit(delta('Partial', 0))
      await session.send('next')
      client.emit(tool)
      client.emit(delta(' more', 7))
      client.emit(frame('message.complete', { text: 'Partial more', status: 'complete' }))
      expect(texts(session.items).slice(2)).toEqual(['work:1', 'assistant:Partial more', 'user:next'])
      expect(new Set(ids(session.items)).size).toBe(session.items.length)
    })

    it('puts the next generation after the queued message', async () => {
      const { client, session } = setup()
      await session.open()
      client.handlers['prompt.submit'] = () => ({ status: 'queued' })
      client.emit(frame('message.start', {}))
      await session.send('next')
      client.emit(frame('message.complete', { text: 'One', status: 'complete' }))
      client.emit(frame('message.start', {}, { execution_generation: 5 }))
      client.emit(frame('message.delta', { text: 'Two', turn_id: 't2', segment: 0, offset: 0 }, { execution_generation: 5 }))
      // The reducer opens an (empty, UI-hidden) work block with every new turn.
      expect(texts(session.items).slice(2)).toEqual(['assistant:One', 'user:next', 'work:0', 'assistant:Two'])
      expect(new Set(ids(session.items)).size).toBe(session.items.length)
    })

    it('adds a lost notice below the running turn instead of splitting it', async () => {
      const { client, session } = setup()
      await session.open()
      client.emit(frame('message.start', {}))
      client.emit(delta('Partial', 0))
      client.handlers['prompt.submit'] = () => ({ status: 'unknown' })
      await session.send('maybe')
      client.emit(delta(' more', 7))
      client.emit(frame('message.complete', { text: 'Partial more', status: 'complete' }))
      expect(texts(session.items).slice(2)).toEqual(['assistant:Partial more', 'user:maybe', 'notice:This message was lost when Hermes restarted'])
    })
  })

  describe('reconnecting', () => {
    const delta = (text: string, offset: number, extra: Record<string, unknown> = {}) =>
      frame('message.delta', { text, turn_id: 't', segment: 0, offset }, extra)

    it('keeps the live turn and does not reload history when the session id is unchanged', async () => {
      const { client, session } = setup({ running: true })
      await session.open()
      const turn = [frame('message.start', {}), delta('Partial', 0), frame('tool.start', { tool_id: 'tool-1', name: 'terminal', context: 'ls' })]
      for (const f of turn) client.emit(f)
      client.setState('closed')
      for (const f of turn) client.emit({ ...f, replayed: true })
      client.setState('open')
      await flush()
      expect(session.canSend).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      client.emit(delta(' more', 7))
      client.emit(frame('message.complete', { text: 'Partial more', status: 'complete' }))
      expect(texts(session.items).slice(2)).toEqual(['work:1', 'assistant:Partial more'])
    })

    it('resets the turn and reloads history when the session id changed', async () => {
      const { client, session } = setup()
      await session.open()
      client.emit(frame('message.start', {}))
      client.emit(delta('Old', 0))
      client.setState('closed')
      client.handlers['session.resume'] = () => ({ session_id: 'live-2', execution_generation: 6, running: false })
      client.setState('open')
      await flush()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(texts(session.items)).toEqual(['user:earlier question', 'assistant:earlier answer'])
    })

    it('reloads from history on a replay gap', async () => {
      const { client, session } = setup()
      await session.open()
      client.emit(frame('message.start', {}))
      client.emit(delta('Stale', 0))
      client.emit(frame('session.replay_gap', {}, { execution_generation: undefined }))
      await flush()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(texts(session.items)).toEqual(['user:earlier question', 'assistant:earlier answer'])
    })

    it('retries a failed re-open and reports the error until it succeeds', async () => {
      const { client, session } = setup()
      await session.open()
      expect(session.error).toBeNull()
      client.setState('closed')
      let attempts = 0
      client.handlers['session.resume'] = () => {
        attempts += 1
        if (attempts === 1) throw new Error('resume failed')
        return { session_id: SID, execution_generation: 3, running: false }
      }
      client.setState('open')
      for (let i = 0; i < 4; i += 1) await flush()
      expect(attempts).toBe(2)
      expect(session.canSend).toBe(true)
      expect(session.error).toBeNull()
    })

    it('shows a reconnecting error while the re-open keeps failing', async () => {
      const { client, session } = setup()
      await session.open()
      client.setState('closed')
      client.handlers['session.resume'] = () => { throw new Error('down') }
      client.setState('open')
      await flush()
      expect(session.canSend).toBe(false)
      expect(session.error).toBe('Reconnecting to the chat…')
      session.close()
    })
  })

  describe('history hydration (W5, W4)', () => {
    it('retries history on the next open instead of treating a failed load as recovered', async () => {
      fetchMock.mockResolvedValueOnce(new Response('boom', { status: 500 }))
      const { session } = setup()
      await expect(session.open()).rejects.toThrow()
      expect(session.canSend).toBe(false)
      await session.open()
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(session.canSend).toBe(true)
      expect(texts(session.items)).toEqual(['user:earlier question', 'assistant:earlier answer'])
    })

    const deferredHistory = () => {
      let release: (r: Response) => void = () => undefined
      fetchMock.mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve }))
      return (rows: unknown[]) => release(historyBody(rows))
    }
    const complete = (rowIds: number[]) => frame('message.complete', { text: 'Reply', status: 'complete', persisted_turn: { row_ids: rowIds, complete: true } })

    it('shows a turn that finished during the history load exactly once (persisted in history)', async () => {
      const release = deferredHistory()
      const { client, session } = setup()
      const opening = session.open()
      await flush()
      client.emit(frame('message.start', {}))
      client.emit(frame('message.delta', { text: 'Reply', turn_id: 't', segment: 0, offset: 0 }))
      client.emit(complete([1, 2]))
      release([row(1, 'user', 'question'), row(2, 'assistant', 'Reply')])
      await opening
      expect(texts(session.items)).toEqual(['user:question', 'assistant:Reply'])
    })

    it('shows a live-only turn once when history does not hold it yet', async () => {
      const release = deferredHistory()
      const { client, session } = setup()
      const opening = session.open()
      await flush()
      client.emit(frame('message.start', {}))
      client.emit(frame('message.delta', { text: 'Reply', turn_id: 't', segment: 0, offset: 0 }))
      client.emit(complete([3, 4]))
      release([row(1, 'user', 'question'), row(2, 'assistant', 'older')])
      await opening
      expect(texts(session.items)).toEqual(['user:question', 'assistant:older', 'assistant:Reply'])
    })

    it('completes a turn that was running at open and finished during the history load (not stuck running)', async () => {
      const release = deferredHistory()
      const { client, session } = setup({ running: true, execution_generation: 4 })
      const opening = session.open()
      await flush()
      client.emit(frame('message.delta', { text: 'Reply', turn_id: 't', segment: 0, offset: 0 }))
      client.emit(complete([1, 2]))
      release([row(1, 'user', 'question'), row(2, 'assistant', 'Reply')])
      await opening
      expect(session.running).toBe(false)
      expect(session.canSend).toBe(true)
      expect(texts(session.items)).toEqual(['user:question', 'assistant:Reply'])
      // The next exchange lands after it, in order.
      await session.send('next')
      client.emit(frame('message.start', {}, { execution_generation: 5 }))
      client.emit(frame('message.delta', { text: 'Second', turn_id: 't2', segment: 0, offset: 0 }, { execution_generation: 5 }))
      expect(texts(session.items).filter(t => t !== 'work:0')).toEqual(['user:question', 'assistant:Reply', 'user:next', 'assistant:Second'])
    })

    it('does the same after a replay gap reload', async () => {
      const { client, session } = setup()
      await session.open()
      const release = deferredHistory()
      client.emit(frame('session.replay_gap', {}, { execution_generation: undefined }))
      await flush()
      client.emit(frame('message.start', {}, { execution_generation: 5 }))
      client.emit(frame('message.delta', { text: 'Reply', turn_id: 't9', segment: 0, offset: 0 }, { execution_generation: 5 }))
      client.emit(frame('message.complete', { text: 'Reply', status: 'complete', persisted_turn: { row_ids: [1, 2], complete: true } }, { execution_generation: 5 }))
      release([row(1, 'user', 'question'), row(2, 'assistant', 'Reply')])
      await flush()
      expect(texts(session.items)).toEqual(['user:question', 'assistant:Reply'])
    })
  })

  describe('resume ordering (W3)', () => {
    it('waits for the replay barrier before advancing the generation or enabling send', async () => {
      const { client, session } = setup({ running: true, execution_generation: 4 })
      await session.open()
      const f = (type: string, payload: unknown, generation: number, extra: Record<string, unknown> = {}) => ({ type, session_id: SID, payload, execution_generation: generation, ...extra })
      client.emit(f('message.start', {}, 4))
      client.emit(f('message.delta', { text: 'partial', turn_id: 't4', segment: 0, offset: 0 }, 4))
      client.setState('closed')

      let openBarrier: (ok: boolean) => void = () => undefined
      client.barriers[SID] = new Promise<boolean>(resolve => { openBarrier = resolve })
      client.handlers['session.resume'] = () => ({ session_id: SID, execution_generation: 5, running: true })
      client.setState('open')
      await flush()
      // The resume answered (generation 5) but the replay of generation 4 has not arrived yet.
      expect(session.canSend).toBe(false)
      client.emit(f('message.delta', { text: ' ending', turn_id: 't4', segment: 0, offset: 7 }, 4, { replayed: true }))
      client.emit(f('message.complete', { text: 'partial ending', status: 'complete' }, 4, { replayed: true }))
      client.emit(f('message.start', {}, 5, { replayed: true }))
      client.emit(f('message.delta', { text: 'next', turn_id: 't5', segment: 0, offset: 0 }, 5, { replayed: true }))
      openBarrier(true)
      await flush()
      expect(session.canSend).toBe(true)
      expect(texts(session.items).filter(t => t.startsWith('assistant:')).slice(1)).toEqual(['assistant:partial ending', 'assistant:next'])
    })

    it('retries the re-open when the replay barrier reports a lost socket', async () => {
      const { client, session } = setup()
      await session.open()
      client.setState('closed')
      client.barriers[SID] = Promise.resolve(false)
      client.setState('open')
      for (let i = 0; i < 3; i += 1) await flush()
      expect(session.canSend).toBe(false)
      expect(session.error).toBe('Reconnecting to the chat…')
      session.close()
    })
  })

  describe('stop (W6)', () => {
    it('scopes the generation to the session id (a new session at generation 1 stops at 1)', async () => {
      const { client, session } = setup({ execution_generation: 12 })
      await session.open()
      client.setState('closed')
      client.handlers['session.resume'] = () => ({ session_id: 'live-2', execution_generation: 1, running: true })
      client.setState('open')
      for (let i = 0; i < 3; i += 1) await flush()
      await session.stop()
      expect(client.callsOf('session.interrupt')[0]?.params).toEqual({ profile: 'default', session_id: 'live-2', execution_generation: 1 })
    })

    it('shows a notice when the interrupt is rejected, in plain words', async () => {
      const { client, session } = setup()
      await session.open()
      client.handlers['session.interrupt'] = () => { throw new JsonRpcGatewayError('session_busy', { code: -32000 }) }
      await session.stop()
      expect(texts(session.items).at(-1)).toBe('notice:Couldn’t stop — session busy')
    })

    it('does not show raw JSON in the stop failure notice', async () => {
      const { client, session } = setup()
      await session.open()
      client.handlers['session.interrupt'] = () => { throw new Error('{"code":-32000,"data":{"x":1}}') }
      await session.stop()
      expect(texts(session.items).at(-1)).toBe('notice:Couldn’t stop — unexpected error')
    })

    it('reports connected state', async () => {
      const { client, session } = setup()
      await session.open()
      expect(session.connected).toBe(true)
      client.setState('closed')
      expect(session.connected).toBe(false)
    })
  })

  describe('uncertain delivery: re-submit under the same id', () => {
    const transportFailure = () => new Error('WebSocket closed')
    const lastUser = (session: ChatSession) => session.items.findLast(i => i.kind === 'user') as Extract<ChatItem, { kind: 'user' }>
    const settle = async () => { for (let i = 0; i < 5; i += 1) await flush() }
    /** First submit loses its receipt with the socket closed; the reconnect then re-resumes. */
    const loseReceipt = async (client: FakeClient, session: ChatSession) => {
      client.handlers['prompt.submit'] = () => { client.setState('closed'); throw transportFailure() }
      await session.send('hello')
    }
    const reconnect = async (client: FakeClient) => {
      client.handlers['session.resume'] = () => ({ session_id: SID, execution_generation: 3, running: false })
      client.setState('open')
      await settle()
    }

    it('shows the message as checking, re-submits once with the same id after re-attach, and shows it once', async () => {
      const { client, session } = setup()
      await session.open()
      await loseReceipt(client, session)
      expect(lastUser(session)).toMatchObject({ text: 'hello', delivery: 'checking' })
      client.handlers['prompt.submit'] = () => ({ status: 'started' })
      await reconnect(client)
      const submits = client.callsOf('prompt.submit')
      expect(submits).toHaveLength(2)
      expect(submits[1]?.params).toMatchObject({ submission_id: submits[0]?.params.submission_id, text: 'hello', session_id: SID })
      expect(session.items.filter(i => i.kind === 'user' && i.text === 'hello')).toHaveLength(1)
      expect(lastUser(session).delivery).toBeUndefined()
      expect(texts(session.items).join('|')).not.toContain('Not sent')
      expect(session.canSend).toBe(true)
    })

    it('does not enable send until the re-submit has finished', async () => {
      const { client, session } = setup()
      await session.open()
      await loseReceipt(client, session)
      let release: (v: unknown) => void = () => undefined
      client.handlers['prompt.submit'] = () => new Promise(resolve => { release = resolve })
      await reconnect(client)
      expect(session.canSend).toBe(false)
      release({ status: 'started' })
      await settle()
      expect(session.canSend).toBe(true)
    })

    it('treats a duplicate answer to the re-submit as delivered (the message stays)', async () => {
      const { client, session } = setup()
      await session.open()
      await loseReceipt(client, session)
      client.handlers['prompt.submit'] = () => ({ status: 'terminal' })
      await reconnect(client)
      expect(lastUser(session)).toMatchObject({ text: 'hello' })
      expect(lastUser(session).delivery).toBeUndefined()
    })

    it('a turn that started before the receipt was lost is covered by the immediate re-submit (socket still up)', async () => {
      const { client, session } = setup()
      await session.open()
      let calls = 0
      client.handlers['prompt.submit'] = () => {
        calls += 1
        if (calls === 1) { client.emit(frame('message.start', {})); throw transportFailure() }
        return { status: 'started' }
      }
      await session.send('hello')
      await settle()
      expect(calls).toBe(2)
      expect(lastUser(session).delivery).toBeUndefined()
      expect(texts(session.items).join('|')).not.toContain('Not sent')
    })

    it('shows Not sent with the reason and a Retry (same id) when the re-submit gets an RPC error', async () => {
      const { client, session } = setup()
      await session.open()
      await loseReceipt(client, session)
      client.handlers['prompt.submit'] = () => { throw new JsonRpcGatewayError('session_busy', { code: -32000 }) }
      await reconnect(client)
      expect(lastUser(session)).toMatchObject({ delivery: 'not_sent', reason: 'Not sent: session_busy' })
      client.handlers['prompt.submit'] = () => ({ status: 'started' })
      await expect(session.retry(lastUser(session).submissionId!)).resolves.toBe('started')
      const submits = client.callsOf('prompt.submit')
      expect(submits.at(-1)?.params.submission_id).toBe(submits[0]?.params.submission_id)
      expect(lastUser(session).delivery).toBeUndefined()
    })

    it('resolves to "couldn’t confirm delivery" when the re-submit also fails at the transport', async () => {
      const { client, session } = setup()
      await session.open()
      await loseReceipt(client, session)
      client.handlers['prompt.submit'] = () => { throw transportFailure() }
      await reconnect(client)
      expect(lastUser(session)).toMatchObject({ delivery: 'not_sent', reason: 'Not sent — couldn’t confirm delivery' })
      expect(session.canSend).toBe(true)
    })

    it('makes a failed Retry visible instead of swallowing it', async () => {
      const { client, session } = setup()
      await session.open()
      await loseReceipt(client, session)
      client.handlers['prompt.submit'] = () => { throw transportFailure() }
      await reconnect(client)
      client.handlers['prompt.submit'] = () => { throw new JsonRpcGatewayError('rate_limited', { code: -32000 }) }
      await expect(session.retry(lastUser(session).submissionId!)).resolves.toBe('not_sent')
      expect(lastUser(session)).toMatchObject({ delivery: 'not_sent', reason: 'Not sent: rate_limited' })
    })

    it('a Retry while disconnected shows why', async () => {
      const { client, session } = setup()
      await session.open()
      await loseReceipt(client, session)
      client.handlers['prompt.submit'] = () => { throw transportFailure() }
      await reconnect(client)
      client.setState('closed')
      await session.retry(lastUser(session).submissionId!)
      expect(lastUser(session)).toMatchObject({ delivery: 'not_sent', reason: 'Not sent — not connected to Hermes' })
    })

    it('never leaves a message checking forever when the re-open keeps failing', async () => {
      const { client, session } = setup()
      await session.open()
      await loseReceipt(client, session)
      client.handlers['session.resume'] = () => { throw new Error('down') }
      client.setState('open')
      await settle()
      expect(lastUser(session)).toMatchObject({ delivery: 'not_sent', reason: 'Not sent — couldn’t confirm delivery' })
      session.close()
    })

    it('does not treat another bot’s message.start as delivery', async () => {
      const { client, session } = setup()
      await session.open()
      await loseReceipt(client, session)
      client.emit({ type: 'message.start', session_id: 'other-bot-session', payload: {}, execution_generation: 9 })
      expect(lastUser(session)).toMatchObject({ delivery: 'checking' })
    })

    it('resolves a message that is still checking after the confirmation timeout', async () => {
      vi.useFakeTimers()
      try {
        const client = new FakeClient()
        client.handlers['session.resume'] = () => ({ session_id: SID, execution_generation: 3, running: false })
        client.handlers['prompt.submit'] = () => { client.setState('closed'); throw new Error('WebSocket closed') }
        const session = new ChatSession(client, bot({ name: 'default', sessionId: 'tip-1' }), { retryDelayMs: () => 0, confirmTimeoutMs: 5000 })
        await session.open()
        await session.send('hello')
        await vi.advanceTimersByTimeAsync(5001)
        expect(session.items.findLast(i => i.kind === 'user')).toMatchObject({ delivery: 'not_sent', reason: 'Not sent — couldn’t confirm delivery' })
      } finally {
        vi.useRealTimers()
      }
    })

    it('keeps the plain Not sent notice for a definite rejection from Hermes', async () => {
      const { client, session } = setup()
      await session.open()
      client.handlers['prompt.submit'] = () => { throw new JsonRpcGatewayError('session_busy', { code: -32000 }) }
      await expect(session.send('nope')).rejects.toThrow('session_busy')
      expect(texts(session.items).at(-1)).toBe('notice:Not sent: session_busy')
    })

  describe('history reload and local messages (submission id)', () => {
    const sendUnconfirmed = async () => {
      const { client, session } = setup()
      await session.open()
      client.handlers['prompt.submit'] = () => { throw new Error('WebSocket closed') }
      await session.send('hello')
      for (let i = 0; i < 4; i += 1) await flush()
      const id = client.callsOf('prompt.submit')[0]!.params.submission_id as string
      return { client, session, id }
    }
    const reload = async (client: FakeClient, rows: unknown[]) => {
      fetchMock.mockImplementation(() => Promise.resolve(historyBody(rows)))
      client.emit(frame('session.replay_gap', {}, { execution_generation: undefined }))
      for (let i = 0; i < 4; i += 1) await flush()
    }
    const hello = (extra: Record<string, unknown> = {}) => ({ ...row(3, 'user', 'hello'), ...extra })
    const count = (session: ChatSession) => session.items.filter(i => i.kind === 'user' && i.text === 'hello').length

    it('drops a local message whose submission id the reloaded history already holds (history wins)', async () => {
      const { client, session, id } = await sendUnconfirmed()
      expect(count(session)).toBe(1)
      await reload(client, [row(1, 'user', 'earlier question'), hello({ display_metadata: { submission_id: id } })])
      expect(count(session)).toBe(1)
      expect(session.items.find(i => i.kind === 'user' && i.text === 'hello')?.id).toBe('row-3')
      await expect(session.retry(id)).rejects.toThrow()
    })

    it('keeps the local message when the history row has no submission id', async () => {
      const { client, session } = await sendUnconfirmed()
      await reload(client, [row(1, 'user', 'earlier question'), hello()])
      expect(count(session)).toBe(2)
    })

    it('keeps both when a different submission id has identical text', async () => {
      const { client, session } = await sendUnconfirmed()
      await reload(client, [row(1, 'user', 'earlier question'), hello({ display_metadata: { submission_id: 'someone-else' } })])
      expect(count(session)).toBe(2)
    })
  })
  })
})
