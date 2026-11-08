import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { signSession } from '../src/auth/session-cookie.js'
import { setLogSink } from '../src/log.js'
import { startWatcher, type WatcherClient } from '../src/watcher/watcher.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

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
  private requestHandlers: ((r: Req) => boolean | void)[] = []
  private eventHandlers: Handler<{ type: string; session_id?: string; payload?: unknown }>[] = []
  close(): void {}
  onRequest(h: (r: Req) => boolean | void): () => void { this.requestHandlers.push(h); return () => undefined }
  onEvent(h: Handler<{ type: string; session_id?: string; payload?: unknown }>): () => void { this.eventHandlers.push(h); return () => undefined }
  onState(): () => void { return () => undefined }
  emitEvent(e: { type: string; session_id?: string; payload?: unknown }): void { for (const h of this.eventHandlers) h(e) }
  emitRequest(r: Req): void { for (const h of this.requestHandlers) h(r) }
  async request<T>(method: string, params: Record<string, unknown> = {}, timeout?: number): Promise<T> {
    this.calls.push({ method, params, ...(timeout ? { timeout } : {}) })
    if (method === 'profiles.list') return { profiles: [{ name: 'crew-test', canonical_session: { id: 'stored' } }] } as T
    if (method === 'session.resume') {
      return { session_id: 'run-fixture', stored_session_id: 'stored', execution_generation: 3, running: false,
        prompts: [{ kind: 'approval', prompt_id: 'p-1', execution_generation: 3, choices: ['once', 'deny'], command: 'rm -r /tmp/x' }] } as T
    }
    if (this.rpcError) throw this.rpcError
    return this.rpcResult as T
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))
let client: Fake
let watcher: ReturnType<typeof startWatcher>
let app: ReturnType<typeof createApp>

beforeEach(async () => {
  client = new Fake()
  watcher = startWatcher({ client, connect: async () => undefined, now: () => 1, reconnectDelayMs: () => 60_000 })
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
      params: { session_id: 'run-fixture', execution_generation: 3, prompt_id: 'p-1', choice: 'deny' }
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
      params: { session_id: 'run-fixture', execution_generation: 4, prompt_id: 'q-1', answer: 'the red one' }
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

  it('settles a held approval server request after respond, and keeps a failed one open', async () => {
    const ok = secretRequest('srq-2', 'approval', { choices: ['once', 'deny'] })
    expect((await post('srq-2', { choice: 'once' })).status).toBe(202)
    expect(ok.respond).toHaveBeenCalledWith({ choice: 'once' })
    expect(entry('srq-2')).toBeUndefined()
    expect(watcher.store.get('srq-2')?.settled).toBe('answered')
    const bad = secretRequest('srq-3', 'sudo')
    bad.respond.mockImplementation(() => { throw new Error('closed') })
    await post('srq-3', { value: 'pw' })
    await flush()
    expect(entry('srq-3')?.state).toBe('failed')
    expect(watcher.store.get('srq-3')?.settled).toBeUndefined()
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

  it('does not leak the value when the answer fails', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    const req = secretRequest()
    req.respond.mockImplementation(() => { throw new Error('socket closed') })
    await post('srq-1', { value: 'sk-live-456' })
    await flush()
    restore()
    expect(entry('srq-1')?.state).toBe('failed')
    expect(JSON.stringify(watcher.state()) + JSON.stringify(watcher.debug()) + lines.join('\n')).not.toContain('sk-live-456')
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
