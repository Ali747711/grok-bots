import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PendingStore } from '../src/watcher/pending-store.js'
import { applyGatewayEvent, routeServerRequest } from '../src/watcher/request-router.js'
import { HermesRpcError, HermesUnavailableError } from '../src/hermes/errors.js'
import { JsonRpcGatewayError } from '../src/vendor/hermes/json-rpc-channel.js'
import { fakeSettings } from './helpers.js'
import { startWatcher, type WatcherClient } from '../src/watcher/watcher.js'

const ctx = { profileForSession: (sid: string) => (sid === 's1' ? 'crew-test' : undefined), now: () => 5_000 }

function fakeRequest(method: string, params: Record<string, unknown>, id = 'srq-1') {
  return { id, method, params, replayed: false, respond: vi.fn(), fail: vi.fn(), decline: vi.fn() }
}

describe('routeServerRequest', () => {
  it('holds approval requests without answering', () => {
    const store = new PendingStore()
    const req = fakeRequest('approval', { session_id: 's1', command: 'rm -r /tmp/x', description: 'delete', choices: ['once', 'deny'] })
    expect(routeServerRequest(req, store, ctx)).toBe(true)
    expect(req.respond).not.toHaveBeenCalled()
    expect(req.fail).not.toHaveBeenCalled()
    expect(req.decline).not.toHaveBeenCalled()
    expect(store.list()[0]).toMatchObject({
      id: 'srq-1', kind: 'approval', profile: 'crew-test', sessionId: 's1', choices: ['once', 'deny'],
      source: 'server_request', receivedAt: 5_000
    })
    expect(store.list()[0]!.summary).toContain('rm -r /tmp/x')
  })

  it.each(['clarify', 'sudo', 'secret'])('holds %s requests', (method) => {
    const store = new PendingStore()
    routeServerRequest(fakeRequest(method, { session_id: 's1', question: 'which?' }), store, ctx)
    expect(store.list()[0]?.kind).toBe(method)
  })

  it('never stores secret values', () => {
    const store = new PendingStore()
    routeServerRequest(fakeRequest('secret', { session_id: 's1', prompt: 'API key for X', value: 'sk-live-123', env_var: 'X_KEY' }), store, ctx)
    expect(JSON.stringify(store.list())).not.toContain('sk-live-123')
  })

  it('accepts and ignores unknown methods: any error reply (even a decline) would skip them for everyone', () => {
    const store = new PendingStore()
    const req = fakeRequest('theme.pick', {})
    expect(routeServerRequest(req, store, ctx)).toBe(true)
    expect(req.respond).not.toHaveBeenCalled()
    expect(req.decline).not.toHaveBeenCalled()
    expect(req.fail).not.toHaveBeenCalled()
    expect(store.list()).toEqual([])
  })
})

describe('applyGatewayEvent', () => {
  it('holds canonical approval.request events and settles them on approval.settled', () => {
    const store = new PendingStore()
    applyGatewayEvent({
      type: 'approval.request', session_id: 's1',
      payload: { prompt_id: 'p-9', execution_generation: 2, kind: 'approval', command: 'rm -r /tmp/crew-fixture/victim', choices: ['once', 'session', 'deny'] }
    }, store, ctx)
    expect(store.list()).toEqual([expect.objectContaining({
      id: 'p-9', kind: 'approval', profile: 'crew-test', sessionId: 's1', source: 'event',
      promptId: 'p-9', executionGeneration: 2, choices: ['once', 'session', 'deny'], receivedAt: 5_000
    })])
    expect(store.list()[0]!.summary).toContain('rm -r /tmp/crew-fixture/victim')
    applyGatewayEvent({ type: 'approval.settled', session_id: 's1', payload: { prompt_id: 'p-9' } }, store, ctx)
    expect(store.list()).toEqual([])
    expect(store.get('p-9')?.settled).toBe('settled')
  })

  it('holds clarify.request events as questions', () => {
    const store = new PendingStore()
    applyGatewayEvent({ type: 'clarify.request', session_id: 's1', payload: { prompt_id: 'q-1', question: 'Which folder?' } }, store, ctx)
    expect(store.list()[0]).toMatchObject({ id: 'q-1', kind: 'clarify', summary: 'Which folder?' })
  })

  it('settles on request.cancel and approval.cancelled events', () => {
    const store = new PendingStore()
    routeServerRequest(fakeRequest('approval', { session_id: 's1' }, 'srq-1'), store, ctx)
    routeServerRequest(fakeRequest('approval', { session_id: 's1' }, 'srq-2'), store, ctx)
    applyGatewayEvent({ type: 'request.cancel', payload: { id: 'srq-1', reason: 'answered elsewhere' } }, store, ctx)
    expect(store.list().map(r => r.id)).toEqual(['srq-2'])
    applyGatewayEvent({ type: 'approval.cancelled', session_id: 's1', payload: { request_ids: ['srq-2'] } }, store, ctx)
    expect(store.list()).toEqual([])
    expect(store.get('srq-2')?.settled).toBe('cancelled')
  })
})

class FakeClient implements WatcherClient {
  fixturePrompts: { kind: string; prompt_id: string; execution_generation: number; choices: string[]; command: string }[] =
    [{ kind: 'approval', prompt_id: 'p-1', execution_generation: 3, choices: ['once', 'deny'], command: 'rm -r /tmp/crew-fixture/victim' }]
  readonly calls: { method: string; params: Record<string, unknown> }[] = []
  private stateHandlers: ((s: string) => void)[] = []
  private eventHandlers: ((e: { type: string; session_id?: string; payload?: unknown }) => void)[] = []
  connects = 0

  async connect(): Promise<void> {
    this.connects += 1
    for (const h of this.stateHandlers) h('open')
  }
  close(): void {}
  onRequest(): () => void { return () => undefined }
  onEvent(h: (e: { type: string; session_id?: string; payload?: unknown }) => void): () => void {
    this.eventHandlers.push(h)
    return () => undefined
  }
  onState(h: (s: string) => void): () => void {
    this.stateHandlers.push(h)
    return () => undefined
  }
  emitState(s: string): void { for (const h of this.stateHandlers) h(s) }
  emitEvent(e: { type: string; session_id?: string; payload?: unknown }): void { for (const h of this.eventHandlers) h(e) }

  async request<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ method, params })
    if (method === 'profiles.list') {
      return { profiles: [
        { name: 'default', canonical_session: { id: 'stored-default' } },
        { name: 'crew-test', canonical_session: { id: 'stored-fixture' } },
        { name: 'no-chat', canonical_session: null }
      ] } as T
    }
    if (method === 'session.resume') {
      const fixture = params.session_id === 'stored-fixture'
      return {
        session_id: fixture ? 'run-fixture' : 'run-default', stored_session_id: params.session_id, subscription_id: 'sub',
        execution_generation: 3, running: fixture,
        prompts: fixture ? this.fixturePrompts : []
      } as T
    }
    return {} as T
  }
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('applyGatewayEvent generation', () => {
  it('reads execution_generation from the top level of the event when the payload lacks it', () => {
    const store = new PendingStore()
    applyGatewayEvent({ type: 'approval.request', session_id: 's1', execution_generation: 7, payload: { prompt_id: 'p-1' } }, store, ctx)
    expect(store.list()[0]?.executionGeneration).toBe(7)
  })
})

describe('startWatcher', () => {
  it('subscribes to every bot chat and records snapshot prompts', async () => {
    const client = new FakeClient()
    const watcher = startWatcher({ client, connect: c => c.connect(), settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 0 })
    await flush(); await flush()
    const resumes = client.calls.filter(c => c.method === 'session.resume')
    expect(resumes.map(r => [r.params.profile, r.params.session_id])).toEqual([['default', 'stored-default'], ['crew-test', 'stored-fixture']])
    expect(resumes.every(r => r.params.omit_messages === true)).toBe(true)
    expect(watcher.store.list()).toEqual([expect.objectContaining({
      id: 'p-1', kind: 'approval', profile: 'crew-test', sessionId: 'run-fixture', source: 'snapshot_prompt',
      promptId: 'p-1', executionGeneration: 3, choices: ['once', 'deny']
    })])
    watcher.stop()
  })

  it('resubscribes after reconnect without duplicating pending prompts', async () => {
    const client = new FakeClient()
    const watcher = startWatcher({ client, connect: c => c.connect(), settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 0 })
    await flush(); await flush()
    client.emitState('closed')
    await flush(); await flush(); await flush()
    expect(client.connects).toBe(2)
    expect(client.calls.filter(c => c.method === 'session.resume').length).toBe(4)
    expect(watcher.store.list().length).toBe(1)
    watcher.stop()
  })

  it('refreshes subscriptions when sessions change', async () => {
    const client = new FakeClient()
    const watcher = startWatcher({ client, connect: c => c.connect(), settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 0 })
    await flush(); await flush()
    client.emitEvent({ type: 'sessions.changed' })
    await flush(); await flush()
    expect(client.calls.filter(c => c.method === 'profiles.list').length).toBe(2)
    watcher.stop()
  })

  it('drops pending prompts that a fresh snapshot no longer lists (missed settled event)', async () => {
    const client = new FakeClient()
    let clock = 0
    const watcher = startWatcher({ client, connect: c => c.connect(), settings: fakeSettings, now: () => ++clock, reconnectDelayMs: () => 0 })
    await flush(); await flush()
    client.emitEvent({ type: 'approval.request', session_id: 'run-fixture', payload: { prompt_id: 'p-2', command: 'rm -r /tmp/y' } })
    client.emitEvent({ type: 'approval.request', session_id: 'run-other', payload: { prompt_id: 'p-3', command: 'ls' } })
    expect(watcher.store.list().map(r => r.id)).toEqual(['p-1', 'p-2', 'p-3'])
    client.fixturePrompts = []
    client.emitState('closed')
    await flush(); await flush(); await flush()
    expect(watcher.store.list().map(r => r.id)).toEqual(['p-3'])
    expect(watcher.store.get('p-1')?.settled).toBe('settled')
    expect(watcher.store.get('p-2')?.settled).toBe('settled')
    watcher.stop()
  })
})


describe('watcher live state', () => {
  const make = (client: FakeClient, extra: Partial<Parameters<typeof startWatcher>[0]> = {}) =>
    startWatcher({ client, connect: c => c.connect(), settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 0, ...extra })

  it('reports the roster, status and connection', async () => {
    const client = new FakeClient()
    const watcher = make(client)
    expect(watcher.state().hermes).toBe('connecting')
    await flush(); await flush()
    const state = watcher.state()
    expect(state.hermes).toBe('connected')
    expect(state.bots.map(b => [b.name, b.status])).toEqual([['default', 'idle'], ['crew-test', 'needs_you'], ['no-chat', 'idle']])
    expect(state.pending).toEqual([expect.objectContaining({ id: 'p-1', state: 'open' })])
    expect(state.pending[0]).not.toHaveProperty('settled')
    watcher.stop()
  })

  it('marks a bot working from live events with top-level stamps', async () => {
    const client = new FakeClient()
    client.fixturePrompts = []
    const watcher = make(client)
    await flush(); await flush()
    client.emitEvent({ type: 'message.start', session_id: 'run-default', execution_generation: 5 } as never)
    expect(watcher.state().bots.find(b => b.name === 'default')?.status).toBe('working')
    watcher.stop()
  })

  it('goes offline on a plain close and signed_out on close code 4401', async () => {
    const client = new FakeClient()
    let closeHandler: (code: number) => void = () => undefined
    const watcher = make(client, { reconnectDelayMs: () => 60_000, onSocketClose: h => { closeHandler = h; return () => undefined } })
    await flush(); await flush()
    client.emitState('closed')
    expect(watcher.state().hermes).toBe('offline')
    closeHandler(4401)
    client.emitState('closed')
    expect(watcher.state().hermes).toBe('signed_out')
    watcher.stop()
  })

  it('reports signed_out when the connect fails with an auth status, offline otherwise', async () => {
    const client = new FakeClient()
    const fail = (message: string) => make(client, { connect: async () => { throw new Error(message) }, reconnectDelayMs: () => 60_000 })
    const a = fail('WebSocket closed during handshake: code 4401')
    await flush(); await flush()
    expect(a.state().hermes).toBe('signed_out')
    a.stop()
    const b = fail('Unexpected server response: 403')
    await flush(); await flush()
    expect(b.state().hermes).toBe('signed_out')
    b.stop()
    const c = fail('connect ECONNREFUSED')
    await flush(); await flush()
    expect(c.state().hermes).toBe('offline')
    c.stop()
  })

  describe('with fake timers', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })
    const settle = async () => { await vi.advanceTimersByTimeAsync(0); await vi.advanceTimersByTimeAsync(0) }

    it('debounces onChange by 100 ms', async () => {
      const client = new FakeClient()
      const watcher = make(client)
      await settle()
      await vi.advanceTimersByTimeAsync(200)
      const listener = vi.fn()
      const off = watcher.onChange(listener)
      client.emitEvent({ type: 'message.start', session_id: 'run-default' })
      client.emitEvent({ type: 'message.complete', session_id: 'run-default' })
      expect(listener).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(100)
      expect(listener).toHaveBeenCalledTimes(1)
      off()
      client.emitEvent({ type: 'message.start', session_id: 'run-default' })
      await vi.advanceTimersByTimeAsync(100)
      expect(listener).toHaveBeenCalledTimes(1)
      watcher.stop()
    })

    it('retries a failed profiles.list with backoff', async () => {
      const client = new FakeClient()
      const original = client.request.bind(client)
      let failures = 2
      client.request = (async (method: string, params?: Record<string, unknown>) => {
        if (method === 'profiles.list' && failures-- > 0) throw new Error('boom')
        return original(method, params)
      }) as typeof client.request
      const watcher = make(client)
      await settle()
      expect(client.calls.filter(c => c.method === 'profiles.list').length).toBe(0)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(2000)
      expect(watcher.state().bots.length).toBe(3)
      watcher.stop()
    })

    it('retries a failed session.resume', async () => {
      const client = new FakeClient()
      const original = client.request.bind(client)
      let failures = 1
      client.request = (async (method: string, params?: Record<string, unknown>) => {
        if (method === 'session.resume' && failures-- > 0) throw new Error('boom')
        return original(method, params)
      }) as typeof client.request
      const watcher = make(client)
      await settle()
      expect(watcher.debug().some(d => d.kind === 'error' && d.detail.startsWith('resume default'))).toBe(true)
      expect(watcher.debug().some(d => d.kind === 'subscribed' && d.detail.startsWith('default'))).toBe(false)
      await vi.advanceTimersByTimeAsync(1000)
      await settle()
      // the failed attempt never reached the fake's call log, so one recorded call = the successful retry
      expect(client.calls.filter(c => c.method === 'session.resume' && c.params.profile === 'default').length).toBe(1)
      expect(watcher.debug().some(d => d.kind === 'subscribed' && d.detail.startsWith('default'))).toBe(true)
      watcher.stop()
    })

    it('prunes settled entries after 10 minutes and re-reads profiles every 30 s', async () => {
      const client = new FakeClient()
      let clock = 0
      const watcher = make(client, { now: () => clock })
      await settle()
      client.emitEvent({ type: 'approval.settled', session_id: 'run-fixture', payload: { prompt_id: 'p-1' } })
      expect(watcher.store.get('p-1')?.settled).toBe('settled')
      const before = client.calls.filter(c => c.method === 'profiles.list').length
      clock = 10 * 60_000 + 1
      await vi.advanceTimersByTimeAsync(30_000)
      expect(watcher.store.get('p-1')).toBeUndefined()
      expect(client.calls.filter(c => c.method === 'profiles.list').length).toBeGreaterThan(before)
      watcher.stop()
    })
  })
})

describe('watcher request and refresh', () => {
  const make = (client: FakeClient) =>
    startWatcher({ client, connect: c => c.connect(), settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 0 })

  it('request rejects while disconnected and sends no frame', async () => {
    const client = new FakeClient()
    const watcher = startWatcher({ client, connect: () => new Promise(() => undefined), settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 0 })
    expect(watcher.state().hermes).toBe('connecting')
    await expect(watcher.request('profiles.list', {})).rejects.toBeInstanceOf(HermesUnavailableError)
    expect(client.calls).toEqual([])
    watcher.stop()
  })

  it('request passes through, defaults to 60 s, and maps JSON-RPC errors', async () => {
    const client = new FakeClient()
    const watcher = make(client)
    await flush(); await flush()
    const timeouts: (number | undefined)[] = []
    const original = client.request.bind(client)
    client.request = (async (method: string, params: Record<string, unknown> = {}, timeoutMs?: number) => {
      timeouts.push(timeoutMs)
      if (method === 'profiles.create') throw new JsonRpcGatewayError('name taken', { code: 4062 })
      return original(method, params)
    }) as typeof client.request
    await watcher.request('profiles.describe', { name: 'x' })
    await expect(watcher.request('profiles.create', { name: 'x' }, 5000)).rejects.toEqual(new HermesRpcError(4062, 'name taken'))
    expect(timeouts).toEqual([60_000, 5000])
    watcher.stop()
  })

  it('refresh during an in-flight sync waits for a fresh sync', async () => {
    const client = new FakeClient()
    const watcher = make(client)
    await flush(); await flush()
    const lists = () => client.calls.filter(c => c.method === 'profiles.list').length
    const before = lists()
    const inFlight = watcher.refresh()
    const seenAtResolve: number[] = []
    const first = watcher.refresh().then(() => seenAtResolve.push(lists()))
    const second = watcher.refresh().then(() => seenAtResolve.push(lists()))
    await Promise.all([inFlight, first, second])
    expect(lists() - before).toBe(2)
    expect(seenAtResolve).toEqual([before + 2, before + 2])
    watcher.stop()
  })

  it('sync passes the roster names to sandboxStates and the view carries the state', async () => {
    const client = new FakeClient()
    const seen: (readonly string[])[] = []
    const watcher = startWatcher({ client, connect: c => c.connect(), settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 0, sandboxStates: async names => { seen.push(names); return new Map([['crew-test', 'on' as const]]) } })
    await flush(); await flush()
    expect(seen[0]).toEqual(['default', 'crew-test', 'no-chat'])
    expect(watcher.state().bots.map(b => [b.name, b.sandbox])).toEqual([['default', 'off'], ['crew-test', 'on'], ['no-chat', 'off']])
    watcher.stop()
  })
})
