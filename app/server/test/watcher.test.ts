import { describe, expect, it, vi } from 'vitest'

import { PendingStore } from '../src/watcher/pending-store.js'
import { applyGatewayEvent, routeServerRequest } from '../src/watcher/request-router.js'
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

  it('declines unknown methods instead of failing them', () => {
    const store = new PendingStore()
    const req = fakeRequest('theme.pick', {})
    expect(routeServerRequest(req, store, ctx)).toBe(true)
    expect(req.decline).toHaveBeenCalled()
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
    expect(store.get('p-9')?.settled).toBe('answered')
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

describe('startWatcher', () => {
  it('subscribes to every bot chat and records snapshot prompts', async () => {
    const client = new FakeClient()
    const watcher = startWatcher({ client, connect: c => c.connect(), now: () => 1, reconnectDelayMs: () => 0 })
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
    const watcher = startWatcher({ client, connect: c => c.connect(), now: () => 1, reconnectDelayMs: () => 0 })
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
    const watcher = startWatcher({ client, connect: c => c.connect(), now: () => 1, reconnectDelayMs: () => 0 })
    await flush(); await flush()
    client.emitEvent({ type: 'sessions.changed' })
    await flush(); await flush()
    expect(client.calls.filter(c => c.method === 'profiles.list').length).toBe(2)
    watcher.stop()
  })

  it('drops pending prompts that a fresh snapshot no longer lists (missed settled event)', async () => {
    const client = new FakeClient()
    let clock = 0
    const watcher = startWatcher({ client, connect: c => c.connect(), now: () => ++clock, reconnectDelayMs: () => 0 })
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

