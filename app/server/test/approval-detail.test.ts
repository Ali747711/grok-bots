import { describe, expect, it, vi } from 'vitest'

import { PendingStore } from '../src/watcher/pending-store.js'
import { applyGatewayEvent, routeServerRequest } from '../src/watcher/request-router.js'
import { fakeSettings } from './helpers.js'
import { startWatcher, type WatcherClient } from '../src/watcher/watcher.js'

const ctx = { profileForSession: () => 'crew-test', now: () => 1 }
const request = (method: string, params: Record<string, unknown>, id = 'srq-1') =>
  ({ id, method, params, replayed: false, respond: vi.fn(), fail: vi.fn(), decline: vi.fn() })

const description = 'd'.repeat(400)
const command = 'rm -r /tmp/crew-fixture/' + 'x'.repeat(375)

describe('approval detail', () => {
  it('keeps the full command and description beside the 300-char summary (server_request)', () => {
    const store = new PendingStore()
    routeServerRequest(request('approval', { session_id: 's', description, command, choices: ['once'] }), store, ctx)
    const entry = store.list()[0]!
    expect(entry.command).toBe(command)
    expect(entry.description).toBe(description)
    expect(entry.summary.length).toBe(300)
    expect(entry).not.toHaveProperty('detailTruncated')
  })

  it('applies to event, open_request and snapshot sources', () => {
    const store = new PendingStore()
    applyGatewayEvent({ type: 'approval.request', session_id: 's', payload: { prompt_id: 'e-1', description: ' why ', command: ' ls ' } }, store, ctx)
    routeServerRequest(request('approval', { session_id: 's', description: 'why', command: 'ls' }, 'srq-2'), store, ctx, 'open_request')
    expect(store.get('e-1')).toMatchObject({ command: 'ls', description: 'why', source: 'event' })
    expect(store.get('srq-2')).toMatchObject({ command: 'ls', description: 'why', source: 'open_request' })
  })

  it('truncates each field at 16384 chars and flags it', () => {
    const store = new PendingStore()
    routeServerRequest(request('approval', { session_id: 's', description: 'short', command: 'c'.repeat(20_000) }), store, ctx)
    const entry = store.list()[0]!
    expect(entry.command!.length).toBe(16_384)
    expect(entry.description).toBe('short')
    expect(entry.detailTruncated).toBe(true)
    routeServerRequest(request('approval', { session_id: 's', description: 'x'.repeat(16_385), command: 'ls' }, 'srq-2'), store, ctx)
    expect(store.get('srq-2')).toMatchObject({ detailTruncated: true })
    expect(store.get('srq-2')!.description!.length).toBe(16_384)
  })

  it('never adds the fields to clarify, secret or sudo', () => {
    const store = new PendingStore()
    routeServerRequest(request('clarify', { session_id: 's', question: 'q', command: 'ls', description: 'x' }, 'a'), store, ctx)
    routeServerRequest(request('secret', { session_id: 's', prompt: 'p', command: 'ls', description: 'x' }, 'b'), store, ctx)
    routeServerRequest(request('sudo', { session_id: 's', prompt: 'p', command: 'ls', description: 'x' }, 'c'), store, ctx)
    applyGatewayEvent({ type: 'clarify.request', session_id: 's', payload: { prompt_id: 'd', question: 'q', command: 'ls', description: 'x' } }, store, ctx)
    for (const entry of store.list()) {
      expect(entry).not.toHaveProperty('command')
      expect(entry).not.toHaveProperty('description')
      expect(entry).not.toHaveProperty('detailTruncated')
    }
  })

  it('exposes the detail in the public state, including snapshot prompts', async () => {
    const client = {
      close: () => undefined, onRequest: () => () => undefined, onEvent: () => () => undefined, onState: () => () => undefined,
      request: async (method: string) => {
        if (method === 'profiles.list') return { profiles: [{ name: 'crew-test', canonical_session: { id: 'stored' } }] }
        return { session_id: 'run', stored_session_id: 'stored', prompts: [{ kind: 'approval', prompt_id: 'p-1', execution_generation: 1, choices: ['once'], description, command }] }
      }
    } as unknown as WatcherClient
    const watcher = startWatcher({ client, connect: async () => undefined, settings: fakeSettings, now: () => 1, reconnectDelayMs: () => 60_000 })
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0))
    const view = watcher.state().pending[0]!
    expect(view).toMatchObject({ command, description })
    expect(view.summary.length).toBe(300)
    watcher.stop()
  })
})
