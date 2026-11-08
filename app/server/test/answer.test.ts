import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { signSession } from '../src/auth/session-cookie.js'
import { setLogSink } from '../src/log.js'
import { startWatcher, type WatcherClient } from '../src/watcher/watcher.js'
import { fakeSettings, HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const sessionValue = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const CSRF = 'csrf-token-value'
const cookie = `crew_session=${sessionValue}; crew_csrf=${CSRF}`

type Handler<T> = (value: T) => void
type Req = Parameters<Parameters<WatcherClient['onRequest']>[0]>[0]

class Fake implements WatcherClient {
  readonly calls: { method: string; params: Record<string, unknown>; timeout?: number }[] = []
  rpcResult: unknown = { status: 'resolved', prompt_id: 'p-1' }
  rpcError: Error | null = null
  openRequests: { id: string; method: string; params: Record<string, unknown> }[] = []
  private requestHandlers: ((r: Req) => boolean | void)[] = []
  private eventHandlers: Handler<{ type: string; session_id?: string; payload?: unknown }>[] = []
  close(): void {}
  onRequest(h: (r: Req) => boolean | void): () => void { this.requestHandlers.push(h); return () => undefined }
  onEvent(h: Handler<{ type: string; session_id?: string; payload?: unknown }>): () => void { this.eventHandlers.push(h); return () => undefined }
  private stateHandlers: Handler<string>[] = []
  onState(h: Handler<string>): () => void { this.stateHandlers.push(h); return () => undefined }
  emitState(state: string): void { for (const h of this.stateHandlers) h(state) }
  emitEvent(e: { type: string; session_id?: string; payload?: unknown }): void { for (const h of this.eventHandlers) h(e) }
  emitRequest(r: Req): void { for (const h of this.requestHandlers) h(r) }
  async request<T>(method: string, params: Record<string, unknown> = {}, timeout?: number): Promise<T> {
    this.calls.push({ method, params, ...(timeout ? { timeout } : {}) })
    if (method === 'profiles.list') return { profiles: [{ name: 'crew-test', canonical_session: { id: 'stored' } }] } as T
    if (method === 'session.resume') {
      return { session_id: 'run-fixture', stored_session_id: 'stored', execution_generation: 3, running: false, open_requests: this.openRequests,
        prompts: [{ kind: 'approval', prompt_id: 'p-1', execution_generation: 3, choices: ['once', 'deny'], command: 'rm -r /tmp/x' }] } as T
    }
    if (this.rpcError) throw this.rpcError
    return this.rpcResult as T
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
let client: Fake
let connectImpl: () => Promise<void> = async () => undefined
let watcher: ReturnType<typeof startWatcher>
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  connectImpl = async () => undefined
  client = new Fake()
  watcher = startWatcher({ client, connect: () => connectImpl(), settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 60_000 })
  await flush(); await flush()
  app = createApp({ ...base, watcher })
})
afterEach(() => watcher.stop())

function post(id: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(`/crew/requests/${id}/answer`, {
    method: 'POST',
    headers: { Host: HOST, Cookie: cookie, Origin: ORIGIN, 'X-Crew-CSRF': CSRF, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}
const entry = (id: string) => watcher.state().pending.find(p => p.id === id)

function secretRequest(value = 'srq-1', method = 'secret', extra: Record<string, unknown> = {}) {
  const req = { id: value, method, params: { session_id: 'run-fixture', prompt: 'API key', env_var: 'K', ...extra },
    replayed: false, respond: vi.fn(), fail: vi.fn(), decline: vi.fn() }
  client.emitRequest(req as unknown as Req)
  return req
}

describe('POST /crew/requests/:id/answer', () => {
  it('answers an approval with the prompt id and its own generation', async () => {
    const res = await post('p-1', { choice: 'deny' })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'sent' })
    expect(client.calls.at(-1)).toEqual({
      method: 'approval.respond', timeout: 1_830_000,
      params: { profile: 'crew-test', session_id: 'run-fixture', execution_generation: 3, prompt_id: 'p-1', choice: 'deny' }
    })
  })

  it('shows answering after dispatch and rejects a second answer meanwhile', async () => {
    let release: (v: unknown) => void = () => undefined
    client.request = (async () => new Promise(r => { release = r })) as typeof client.request
    expect((await post('p-1', { choice: 'once' })).status).toBe(202)
    expect(entry('p-1')?.state).toBe('answering')
    const again = await post('p-1', { choice: 'once' })
    expect(again.status).toBe(409)
    expect(await again.json()).toEqual({ status: 'answering' })
    release({ status: 'resolved' })
  })

  it('answers a clarify event through clarify.respond', async () => {
    client.emitEvent({ type: 'clarify.request', session_id: 'run-fixture', payload: { prompt_id: 'q-1', execution_generation: 4, question: 'Which?' } })
    expect((await post('q-1', { answer: 'the red one' })).status).toBe(202)
    expect(client.calls.at(-1)).toEqual({
      method: 'clarify.respond', timeout: 1_830_000,
      params: { profile: 'crew-test', session_id: 'run-fixture', execution_generation: 4, prompt_id: 'q-1', answer: 'the red one' }
    })
  })

  it('rejects a choice Hermes did not offer with 400', async () => {
    const res = await post('p-1', { choice: 'always' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_choice' })
    expect(client.calls.some(c => c.method === 'approval.respond')).toBe(false)
  })

  it('rejects a wrong body shape or oversized text with 400 bad_body', async () => {
    for (const body of [{ answer: 'x' }, {}, { choice: 5 }]) {
      const res = await post('p-1', body)
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_body' })
    }
    secretRequest()
    expect((await post('srq-1', { value: 'x'.repeat(4001) })).status).toBe(400)
  })

  it('answers a secret through the held server request and never stores the value', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    const req = secretRequest()
    const res = await post('srq-1', { value: 'sk-live-123' })
    expect(res.status).toBe(202)
    expect(req.respond).toHaveBeenCalledWith({ value: 'sk-live-123' })
    expect(req.fail).not.toHaveBeenCalled()
    expect(req.decline).not.toHaveBeenCalled()
    await flush()
    restore()
    expect(entry('srq-1')).toBeUndefined()
    expect(watcher.store.get('srq-1')?.settled).toBe('answered')
    const exposed = JSON.stringify(watcher.state()) + JSON.stringify(watcher.debug()) + lines.join('\n') + JSON.stringify(watcher.store.get('srq-1'))
    expect(exposed).not.toContain('sk-live-123')
  })

  it('settles a held approval server request after respond', async () => {
    const ok = secretRequest('srq-2', 'approval', { choices: ['once', 'deny'] })
    expect((await post('srq-2', { choice: 'once' })).status).toBe(202)
    expect(ok.respond).toHaveBeenCalledWith({ choice: 'once' })
    expect(entry('srq-2')).toBeUndefined()
    expect(watcher.store.get('srq-2')?.settled).toBe('answered')
  })

  it('refuses to answer while Hermes is not connected: 503, entry failed not_connected, request left unused', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    const req = secretRequest()
    client.emitState('closed')
    expect(watcher.state().hermes).toBe('offline')
    const res = await post('srq-1', { value: 'sk-live-789' })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'hermes_offline' })
    await flush()
    restore()
    expect(req.respond).not.toHaveBeenCalled()
    expect(entry('srq-1')).toMatchObject({ state: 'failed', error: 'not_connected' })
    expect(watcher.store.get('srq-1')?.settled).toBeUndefined()
    expect(JSON.stringify(watcher.state()) + JSON.stringify(watcher.debug()) + lines.join('\n')).not.toContain('sk-live-789')
    // prompt entries fail fast the same way
    expect((await post('p-1', { choice: 'deny' })).status).toBe(503)
    expect(client.calls.some(c => c.method === 'approval.respond')).toBe(false)
  })

  it('accepts the replayed request after reconnect and answers it with the fresh object', async () => {
    watcher.stop()
    watcher = startWatcher({ client, connect: () => connectImpl(), settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 0 })
    app = createApp({ ...base, watcher })
    await flush(); await flush()
    const stale = secretRequest()
    let release: () => void = () => undefined
    connectImpl = () => new Promise<void>(resolve => { release = resolve })
    client.emitState('closed')
    await flush()
    expect(watcher.state().hermes).toBe('connecting')
    expect((await post('srq-1', { value: 'v' })).status).toBe(503)
    expect(entry('srq-1')).toMatchObject({ state: 'failed', error: 'not_connected' })
    client.openRequests = [{ id: 'srq-1', method: 'secret', params: { session_id: 'run-fixture' } }]
    release()
    await flush(); await flush(); await flush()
    expect(watcher.state().hermes).toBe('connected')
    const fresh = secretRequest()
    expect((await post('srq-1', { value: 'again' })).status).toBe(202)
    expect(fresh.respond).toHaveBeenCalledWith({ value: 'again' })
    expect(stale.respond).not.toHaveBeenCalled()
    expect(watcher.store.get('srq-1')?.settled).toBe('answered')
  })

  it('does not answer held clarify server requests: 422 unsupported, nothing sent, answerable false', async () => {
    const req = secretRequest('srq-4', 'clarify')
    expect(entry('srq-4')?.answerable).toBe(false)
    expect(entry('p-1')?.answerable).toBe(true)
    const res = await post('srq-4', { answer: 'x' })
    expect(res.status).toBe(422)
    expect(await res.json()).toEqual({ error: 'unsupported', hint: 'answer in the app that asked' })
    expect(req.respond).not.toHaveBeenCalled()
    expect(req.fail).not.toHaveBeenCalled()
    expect(req.decline).not.toHaveBeenCalled()
  })

  it('second answer reports already_resolved once Hermes settles the entry', async () => {
    expect((await post('p-1', { choice: 'deny' })).status).toBe(202)
    client.emitEvent({ type: 'approval.settled', session_id: 'run-fixture', payload: { prompt_id: 'p-1' } })
    const second = await post('p-1', { choice: 'deny' })
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ status: 'already_resolved' })
  })

  it('treats an already_resolved result as settled, not as an error', async () => {
    client.rpcResult = { status: 'already_resolved', prompt_id: 'p-1' }
    await post('p-1', { choice: 'deny' })
    await flush()
    expect(entry('p-1')).toBeUndefined()
    expect(watcher.store.get('p-1')?.settled).toBe('settled')
  })

  it('marks the entry failed with the hermes reason on stale_generation, and allows a retry', async () => {
    client.rpcError = new Error('stale_generation')
    expect((await post('p-1', { choice: 'deny' })).status).toBe(202)
    await flush()
    expect(entry('p-1')).toMatchObject({ state: 'failed', error: 'stale_generation' })
    client.rpcError = null
    expect((await post('p-1', { choice: 'deny' })).status).toBe(202)
  })

  it('marks entries Crew cannot answer as answerable false and refuses them with 422', async () => {
    client.emitEvent({ type: 'approval.request', session_id: 'run-fixture', payload: { prompt_id: 'p-nogen', command: 'ls', choices: ['once'] } })
    const openRequest = { id: 'srq-9', method: 'approval', params: { session_id: 'run-fixture', command: 'ls' }, replayed: true, respond: vi.fn(), fail: vi.fn(), decline: vi.fn() }
    watcher.store.add({ id: 'srq-9', kind: 'approval', profile: 'crew-test', sessionId: 'run-fixture', summary: 's', choices: ['once'], receivedAt: 1, source: 'open_request' })
    for (const id of ['p-nogen', 'srq-9']) {
      expect(entry(id)?.answerable).toBe(false)
      const res = await post(id, { choice: 'once' })
      expect(res.status).toBe(422)
      expect(await res.json()).toEqual({ error: 'unsupported', hint: 'answer in the app that asked' })
    }
    expect(openRequest.respond).not.toHaveBeenCalled()
    expect(client.calls.some(c => c.method === 'approval.respond')).toBe(false)
    expect(entry('p-1')?.answerable).toBe(true)
  })

  it('does not answer prompts whose bot is unknown (no profile to route by)', async () => {
    client.emitEvent({ type: 'approval.request', session_id: 'run-mystery', execution_generation: 1, payload: { prompt_id: 'p-x', command: 'ls', choices: ['once'] } })
    expect(entry('p-x')).toMatchObject({ profile: 'unknown', answerable: false })
    expect((await post('p-x', { choice: 'once' })).status).toBe(422)
  })

  it('maps a Hermes not_found reply to failed with that error', async () => {
    client.rpcError = new Error('not_found')
    await post('p-1', { choice: 'deny' })
    await flush()
    expect(entry('p-1')).toMatchObject({ state: 'failed', error: 'not_found' })
  })

  it('refuses answers when the connection closed during the initial sync', async () => {
    watcher.stop()
    const c = new Fake()
    const original = c.request.bind(c)
    c.request = (async (method: string, params?: Record<string, unknown>) => {
      const result = await original(method, params)
      if (method === 'profiles.list') c.emitState('closed')
      return result
    }) as typeof c.request
    client = c
    watcher = startWatcher({ client: c, connect: async () => undefined, settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 60_000 })
    app = createApp({ ...base, watcher })
    await flush(); await flush(); await flush()
    const req = secretRequest()
    expect(watcher.state().hermes).toBe('offline')
    const res = await post('srq-1', { value: 'v' })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'hermes_offline' })
    expect(req.respond).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown id', async () => {
    const res = await post('nope', { choice: 'deny' })
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'not_found' })
  })

  it('requires a session, Origin and CSRF', async () => {
    const send = (headers: Record<string, string>, omit: string[] = []) => {
      const h: Record<string, string> = { Host: HOST, 'Content-Type': 'application/json', ...headers }
      for (const k of omit) delete h[k]
      return app.request('/crew/requests/p-1/answer', { method: 'POST', headers: h, body: JSON.stringify({ choice: 'deny' }) })
    }
    expect((await send({ Cookie: cookie, 'X-Crew-CSRF': CSRF })).status).toBe(403)
    expect((await send({ Cookie: cookie, Origin: ORIGIN })).status).toBe(403)
    expect([401, 403]).toContain((await send({ Origin: ORIGIN, 'X-Crew-CSRF': CSRF })).status)
    expect(client.calls.some(c => c.method === 'approval.respond')).toBe(false)
  })
})

describe('answer audit trail', () => {
  const capture = () => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    const events = (msg: string) => lines.map(l => JSON.parse(l) as Record<string, unknown>).filter(e => e.msg === msg)
    return { lines, restore, events }
  }

  it('logs one `answer received` line per approval request with attribution fields', async () => {
    const cap = capture()
    await post('p-1', { choice: 'deny' }, { 'User-Agent': 'Mozilla/5.0 test', 'Sec-Fetch-Site': 'same-origin' })
    await flush()
    cap.restore()
    expect(cap.events('answer received')).toEqual([expect.objectContaining({
      id: 'p-1', kind: 'approval', profile: 'crew-test', choice: 'deny', hasText: false, status: 202,
      ua: 'Mozilla/5.0 test', origin: ORIGIN, fetchSite: 'same-origin'
    })])
  })

  it('records rejected and unknown requests too, with null for missing headers', async () => {
    const cap = capture()
    await post('p-1', { choice: 'bogus' })
    await post('nope', { choice: 'deny' })
    cap.restore()
    const got = cap.events('answer received')
    expect(got.map(e => [e.id, e.status])).toEqual([['p-1', 400], ['nope', 404]])
    expect(got[0]).toMatchObject({ ua: null, fetchSite: null })
    expect(got[1]).toMatchObject({ kind: null, profile: null })
  })

  it('cuts the user agent to 200 characters', async () => {
    const cap = capture()
    await post('p-1', { choice: 'deny' }, { 'User-Agent': 'x'.repeat(300) })
    cap.restore()
    expect((cap.events('answer received')[0]!.ua as string).length).toBe(200)
  })

  it('never logs a secret value or its length', async () => {
    const cap = capture()
    secretRequest()
    await post('srq-1', { value: 'sk-live-123' })
    await flush()
    cap.restore()
    const received = cap.events('answer received')[0]!
    expect(received).toMatchObject({ id: 'srq-1', kind: 'secret', hasText: true, status: 202 })
    expect(received).not.toHaveProperty('choice')
    expect(cap.lines.join('\n')).not.toContain('sk-live-123')
    expect(cap.lines.join('\n')).not.toMatch(/"(length|len|size)"/)
    expect(JSON.stringify(cap.events('answer sent'))).not.toContain('sk-live-123')
  })

  it('logs `answer sent` then `answer outcome` for an RPC answer', async () => {
    const cap = capture()
    await post('p-1', { choice: 'deny' })
    await flush()
    cap.restore()
    expect(cap.events('answer sent')).toEqual([expect.objectContaining({ id: 'p-1', kind: 'approval', profile: 'crew-test', method: 'approval.respond', choice: 'deny' })])
    expect(cap.events('answer outcome')).toEqual([expect.objectContaining({ id: 'p-1', kind: 'approval', ok: true, status: 'resolved' })])
  })

  it('logs the reason when the RPC rejects', async () => {
    const cap = capture()
    client.rpcError = new Error('stale_generation')
    await post('p-1', { choice: 'deny' })
    await flush()
    cap.restore()
    expect(cap.events('answer outcome')).toEqual([expect.objectContaining({ id: 'p-1', ok: false, reason: 'stale_generation' })])
  })

  it('logs server_request.respond for a held secret', async () => {
    const cap = capture()
    secretRequest()
    await post('srq-1', { value: 'v' })
    await flush()
    cap.restore()
    expect(cap.events('answer sent')).toEqual([expect.objectContaining({ id: 'srq-1', kind: 'secret', method: 'server_request.respond' })])
    expect(cap.events('answer outcome')).toEqual([expect.objectContaining({ id: 'srq-1', ok: true })])
  })

  it('logs `request settled` once, with answeredByCrew false for an event settle and true after a Crew answer', async () => {
    const cap = capture()
    client.emitEvent({ type: 'clarify.request', session_id: 'run-fixture', payload: { prompt_id: 'q-1', execution_generation: 4, question: 'Which?' } })
    client.emitEvent({ type: 'clarify.settled', session_id: 'run-fixture', payload: { prompt_id: 'q-1' } })
    client.emitEvent({ type: 'clarify.settled', session_id: 'run-fixture', payload: { prompt_id: 'q-1' } })
    await post('p-1', { choice: 'deny' })
    await flush()
    client.emitEvent({ type: 'approval.settled', session_id: 'run-fixture', payload: { prompt_id: 'p-1' } })
    cap.restore()
    expect(cap.events('request settled')).toEqual([
      expect.objectContaining({ id: 'q-1', kind: 'clarify', profile: 'crew-test', reason: 'settled', answeredByCrew: false }),
      expect.objectContaining({ id: 'p-1', kind: 'approval', profile: 'crew-test', reason: 'settled', answeredByCrew: true })
    ])
  })
})


describe('session tip following', () => {
  function tipClient() {
    const calls: { method: string; params: Record<string, unknown> }[] = []
    const handlers: Handler<{ type: string; session_id?: string; payload?: unknown }>[] = []
    let resolvedId = 'A'
    const c = {
      calls,
      setTip: (id: string) => { resolvedId = id },
      emitEvent: (e: { type: string; session_id?: string; payload?: unknown }) => { for (const h of handlers) h(e) },
      close: () => undefined,
      onRequest: () => () => undefined,
      onEvent: (h: Handler<{ type: string; session_id?: string; payload?: unknown }>) => { handlers.push(h); return () => undefined },
      onState: () => () => undefined,
      request: async (method: string, params: Record<string, unknown> = {}) => {
        calls.push({ method, params })
        if (method === 'profiles.list') return { profiles: [{ name: 'crew-test', canonical_session: { id: 'root', resolved_id: resolvedId } }] }
        if (method === 'session.resume') {
          return { session_id: `live-${String(params.session_id)}`, stored_session_id: params.session_id, execution_generation: 1, running: false, prompts: [] }
        }
        return { status: 'resolved' }
      }
    }
    return c
  }

  it('resumes a changed tip, repairs an unknown-owner approval and answers with the right profile and session', async () => {
    const c = tipClient()
    const w = startWatcher({ client: c as unknown as WatcherClient, connect: async () => undefined, settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 60_000 })
    await flush(); await flush()
    expect(c.calls.filter(x => x.method === 'session.resume').map(x => x.params.session_id)).toEqual(['A'])
    c.setTip('B')
    c.emitEvent({ type: 'approval.request', session_id: 'B', execution_generation: 2, payload: { prompt_id: 'p-b', command: 'ls', choices: ['once', 'deny'] } })
    const before = w.state()
    expect(before.pending[0]).toMatchObject({ profile: 'unknown', answerable: false })
    expect(before.bots[0]!.status).toBe('idle')
    c.emitEvent({ type: 'sessions.changed' })
    await flush(); await flush(); await flush()
    expect(c.calls.filter(x => x.method === 'session.resume').map(x => x.params.session_id)).toEqual(['A', 'B'])
    const after = w.state()
    expect(after.pending[0]).toMatchObject({ id: 'p-b', profile: 'crew-test', answerable: true })
    expect(after.bots[0]!.status).toBe('needs_you')
    const appB = createApp({ ...base, watcher: w })
    const res = await appB.request('/crew/requests/p-b/answer', {
      method: 'POST',
      headers: { Host: HOST, Cookie: cookie, Origin: ORIGIN, 'X-Crew-CSRF': CSRF, 'Content-Type': 'application/json' },
      body: JSON.stringify({ choice: 'deny' })
    })
    expect(res.status).toBe(202)
    expect(c.calls.at(-1)).toEqual({
      method: 'approval.respond',
      params: { profile: 'crew-test', session_id: 'B', execution_generation: 2, prompt_id: 'p-b', choice: 'deny' }
    })
    w.stop()
  })

  it('does not resume again while the tip is unchanged', async () => {
    const c = tipClient()
    const w = startWatcher({ client: c as unknown as WatcherClient, connect: async () => undefined, settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 60_000 })
    await flush(); await flush()
    c.emitEvent({ type: 'sessions.changed' })
    await flush(); await flush()
    expect(c.calls.filter(x => x.method === 'session.resume').length).toBe(1)
    w.stop()
  })

  it('repairs an unknown owner as soon as the roster names the session, even before a resume', async () => {
    const c = tipClient()
    const w = startWatcher({ client: c as unknown as WatcherClient, connect: async () => undefined, settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 60_000 })
    await flush(); await flush()
    w.store.add({ id: 'orphan', kind: 'approval', profile: 'unknown', sessionId: 'root', summary: 's', receivedAt: 1, source: 'event', promptId: 'orphan', executionGeneration: 1, choices: ['once'] })
    c.emitEvent({ type: 'sessions.changed' })
    await flush(); await flush()
    expect(w.state().pending[0]).toMatchObject({ id: 'orphan', profile: 'crew-test' })
    w.stop()
  })
})


describe('stale server-request handles after a reconnect', () => {
  async function reconnecting() {
    watcher.stop()
    let clock = 0
    watcher = startWatcher({ client, connect: () => connectImpl(), settings: fakeSettings, now: () => ++clock, reconnectDelayMs: () => 0 })
    app = createApp({ ...base, watcher })
    await flush(); await flush()
    const stale = secretRequest()
    let release: () => void = () => undefined
    connectImpl = () => new Promise<void>(resolve => { release = resolve })
    client.emitState('closed')
    await flush()
    return { stale, reconnect: async () => { release(); await flush(); await flush(); await flush() } }
  }

  it('drops the handle on disconnect: the entry is not answerable until reconciled', async () => {
    const { stale } = await reconnecting()
    expect(entry('srq-1')?.answerable).toBe(false)
    expect((await post('srq-1', { value: 'v' })).status).toBe(503)
    expect(stale.respond).not.toHaveBeenCalled()
  })

  it('settles a held secret that Hermes no longer lists after reconnect, and never calls the old closure', async () => {
    const { stale, reconnect } = await reconnecting()
    client.openRequests = []
    await reconnect()
    expect(watcher.state().hermes).toBe('connected')
    expect(entry('srq-1')).toBeUndefined()
    expect(watcher.store.get('srq-1')?.settled).toBe('settled')
    const res = await post('srq-1', { value: 'v' })
    expect(res.status).not.toBe(202)
    expect(res.status).toBe(409)
    expect(stale.respond).not.toHaveBeenCalled()
  })

  it('refuses answers between reconnect and the replayed handle (422, nothing sent)', async () => {
    const { stale, reconnect } = await reconnecting()
    client.openRequests = [{ id: 'srq-1', method: 'secret', params: { session_id: 'run-fixture' } }]
    await reconnect()
    expect(entry('srq-1')).toMatchObject({ answerable: false })
    const res = await post('srq-1', { value: 'v' })
    expect(res.status).toBe(422)
    expect(stale.respond).not.toHaveBeenCalled()
  })

  it('binds the new handle when Hermes still lists the request, and answers only through it', async () => {
    const { stale, reconnect } = await reconnecting()
    client.openRequests = [{ id: 'srq-1', method: 'secret', params: { session_id: 'run-fixture' } }]
    await reconnect()
    const fresh = secretRequest()
    expect(entry('srq-1')).toMatchObject({ answerable: true })
    expect((await post('srq-1', { value: 'again' })).status).toBe(202)
    expect(fresh.respond).toHaveBeenCalledWith({ value: 'again' })
    expect(stale.respond).not.toHaveBeenCalled()
  })
})
