import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { setBotApps, type ConnectorDeps } from '../src/connectors/bot-apps.js'
import type { Composio } from '../src/connectors/composio.js'
import { IDENTITY_RETRY_MS, createIdentityBackfill, ensureIdentity, rotateToken, unmarkRecord } from '../src/connectors/identity.js'
import { ConnectorStore, hashToken, type BotRecord } from '../src/connectors/store.js'
import { HermesRestError, HermesRpcError } from '../src/hermes/errors.js'
import { setLogSink } from '../src/log.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

const legacy = (bot: string): BotRecord => ({
  apps: { github: 'all' }, counts: { github: { tools: 2, capped: false } }, sessionId: `sess_${bot}`,
  mcpUrl: `https://backend.composio.dev/tool_router/sess_${bot}/mcp`, allowed: ['GITHUB_GET', 'GITHUB_DELETE'],
  tokenHash: hashToken(`old-${bot}`)
})

describe('apps identity backfill', () => {
  let dir: string
  let file: string
  let store: ConnectorStore
  let rpc: FakeRpc
  let rest: FakeRest
  let calls: string[]
  let scheduled: string[]
  let servers: Record<string, { enabled: boolean } | null>
  let key: string | null
  let now: number
  let tokens: number
  let composioCalls: number
  let reconnectOk: boolean
  let deps: ConnectorDeps

  beforeAll(() => { setLogSink(() => undefined) })
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'identity-'))
    file = join(dir, 'c.json')
    store = await ConnectorStore.load(file, () => '11111111-1111-4111-8111-111111111111')
    rpc = new FakeRpc()
    rest = new FakeRest()
    calls = []
    scheduled = []
    servers = { default: { enabled: true }, bella: { enabled: true } }
    key = 'ak_test_key_123'
    now = 1_000
    tokens = 0
    composioCalls = 0
    reconnectOk = true
    const of = (q?: Record<string, string>): string => q?.profile ?? ''
    rpc.handlers.set('mcp.servers.add', p => {
      calls.push(`add:${p.profile as string}`)
      servers[p.profile as string] = { enabled: (p.config as { enabled: boolean }).enabled }
      return { ok: true }
    })
    rest.routes.set('GET /api/mcp/servers', r => {
      const server = servers[of(r.query)]
      return { servers: server ? [{ name: 'crew_apps', ...server }] : [] }
    })
    rest.routes.set('GET /api/config', () => ({}))
    rest.routes.set('DELETE /api/mcp/servers/crew_apps', r => { calls.push(`remove:${of(r.query)}`); servers[of(r.query)] = null; return {} })
    rest.routes.set('DELETE /api/env', r => { calls.push(`env:${(r.body as { profile: string }).profile}`); return {} })
    const composio = new Proxy({}, { get: () => async () => { composioCalls += 1; throw new Error('composio must not be called') } }) as Composio
    deps = {
      bots: { rpc: rpc.call, rest: rest as never }, composio, keys: { get: () => key }, store,
      reconnector: { schedule: b => scheduled.push(b), idle: async () => undefined, settled: async () => reconnectOk },
      relayUrl: b => `http://127.0.0.1:7070/mcp/${b}`, newToken: () => `tok${++tokens}`, now: () => now
    }
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it("replaces an older bot's entry with one that carries the identity header, a fresh token and a reconnect", async () => {
    await store.setRecord('bella', legacy('bella'))
    expect(await ensureIdentity(deps, 'bella')).toBe('done')
    expect(calls).toEqual(['remove:bella', 'env:bella', 'add:bella'])
    expect(rpc.params('mcp.servers.add')).toEqual({
      profile: 'bella', name: 'crew_apps', bearer_token: 'tok1',
      config: { url: 'http://127.0.0.1:7070/mcp/bella', trust: 'untrusted', enabled: true, identity_header: { name: 'X-Crew-Bot', value_from: 'profile' } }
    })
    expect(store.record('bella')).toEqual({ ...legacy('bella'), tokenHash: hashToken('tok1'), identity: true })
    expect(scheduled).toEqual(['bella'])
  })

  it('leaves the primary working: same apps, levels and session, its own URL, no Composio call', async () => {
    await store.setRecord('default', legacy('default'))
    expect(await ensureIdentity(deps, 'default')).toBe('done')
    const { tokenHash: _old, ...kept } = legacy('default')
    expect(store.record('default')).toMatchObject({ ...kept, identity: true })
    expect((rpc.params('mcp.servers.add')?.config as { url: string }).url).toBe('http://127.0.0.1:7070/mcp/default')
    expect(servers.default).toEqual({ enabled: true })
    expect(composioCalls).toBe(0)
    expect(scheduled).toEqual(['default'])
  })

  it('is idempotent: a second run, a restart, and bots made after the fix change nothing', async () => {
    await store.setRecord('bella', legacy('bella'))
    await ensureIdentity(deps, 'bella')
    calls.length = 0
    scheduled.length = 0
    const before = store.record('bella')
    expect(await ensureIdentity(deps, 'bella')).toBe('none')
    const reloaded = await ConnectorStore.load(file, () => 'unused')
    expect(reloaded.record('bella')).toEqual(before)
    expect(await ensureIdentity({ ...deps, store: reloaded }, 'bella')).toBe('none')
    expect(await ensureIdentity(deps, 'nobody')).toBe('none')
    expect(calls).toEqual([])
    expect(scheduled).toEqual([])
    expect(tokens).toBe(1)
  })

  it('marks records made by setBotApps, so new bots are never migrated', async () => {
    const composio = {
      toolsOf: async () => [{ slug: 'GITHUB_GET', readOnly: true, destructive: false }],
      toolkit: async (slug: string) => ({ slug, name: 'GitHub' }),
      createSession: async () => ({ sessionId: 's1', mcpUrl: 'https://backend.composio.dev/tool_router/s1/mcp' }),
      deleteSession: async () => undefined
    } as unknown as Composio
    servers.scout = null
    const live = { ...deps, composio }
    await setBotApps(live, 'scout', { github: 'read' })
    expect(store.record('scout')?.identity).toBe(true)
    expect(rpc.params('mcp.servers.add')?.config).toMatchObject({ identity_header: { name: 'X-Crew-Bot', value_from: 'profile' } })
    calls.length = 0
    expect(await ensureIdentity(live, 'scout')).toBe('none')
    expect(calls).toEqual([])
  })

  it('keeps an older record unmarked through a level change, and marks it when its missing server is re-added', async () => {
    const composio = {
      toolsOf: async () => [{ slug: 'GITHUB_GET', readOnly: true, destructive: false }],
      toolkit: async (slug: string) => ({ slug, name: 'GitHub' }),
      createSession: async () => ({ sessionId: 's2', mcpUrl: 'https://backend.composio.dev/tool_router/s2/mcp' }),
      deleteSession: async () => undefined
    } as unknown as Composio
    const live = { ...deps, composio }
    await store.setRecord('bella', legacy('bella'))
    await setBotApps(live, 'bella', { github: 'read' })
    expect(store.record('bella')?.identity).toBeUndefined()
    servers.bella = null
    await setBotApps(live, 'bella', { github: 'read' })
    expect(store.record('bella')?.identity).toBe(true)
  })

  it('keeps a paused bot paused and adds a missing server without removing anything', async () => {
    await store.setRecord('bella', legacy('bella'))
    servers.bella = { enabled: false }
    await ensureIdentity(deps, 'bella')
    expect(servers.bella).toEqual({ enabled: false })
    expect(scheduled).toEqual([])
    await store.setRecord('default', legacy('default'))
    servers.default = null
    key = null
    calls.length = 0
    await ensureIdentity(deps, 'default')
    expect(calls).toEqual(['add:default'])
    expect(servers.default).toEqual({ enabled: false })
    expect(scheduled).toEqual([])
  })

  it('keeps a truly paused bot paused: no key, its server present and disabled, no reconnect, still marked', async () => {
    await store.setRecord('bella', legacy('bella'))
    servers.bella = { enabled: false }
    key = null
    expect(await ensureIdentity(deps, 'bella')).toBe('done')
    expect(calls).toEqual(['remove:bella', 'env:bella', 'add:bella'])
    expect((rpc.params('mcp.servers.add')?.config as { enabled: boolean }).enabled).toBe(false)
    expect(servers.bella).toEqual({ enabled: false })
    expect(scheduled).toEqual([])
    expect(store.record('bella')).toMatchObject({ identity: true, tokenHash: hashToken('tok1') })
  })

  it('does not mark the record when the reconnect fails, and the next roster sync runs it again', async () => {
    await store.setRecord('default', legacy('default'))
    reconnectOk = false
    expect(await ensureIdentity(deps, 'default')).toBe('unconfirmed')
    expect(store.record('default')?.identity).toBeUndefined()
    expect(store.record('default')?.tokenHash).toBe(hashToken('tok1'))
    const backfill = createIdentityBackfill(deps)
    backfill.onRoster(['default'])
    await backfill.idle()
    expect(store.record('default')?.identity).toBeUndefined()
    reconnectOk = true
    now += IDENTITY_RETRY_MS
    backfill.onRoster(['default'])
    await backfill.idle()
    expect(store.record('default')).toMatchObject({ identity: true, tokenHash: hashToken('tok3') })
    expect(scheduled).toEqual(['default', 'default', 'default'])
  })

  it('rotates a marked bot on demand: the old token dies, the entry is rewritten, and the mark returns only after the reconnect', async () => {
    await store.setRecord('default', { ...legacy('default'), identity: true })
    expect(await rotateToken(deps, 'default')).toBe('done')
    expect(calls).toEqual(['remove:default', 'env:default', 'add:default'])
    expect(store.record('default')).toMatchObject({ identity: true, tokenHash: hashToken('tok1') })
    expect(scheduled).toEqual(['default'])
    reconnectOk = false
    expect(await rotateToken(deps, 'default')).toBe('unconfirmed')
    expect(store.record('default')?.identity).toBeUndefined()
    expect(store.record('default')?.tokenHash).toBe(hashToken('tok2'))
    expect(await rotateToken(deps, 'nobody')).toBe('none')
    expect(composioCalls).toBe(0)
  })

  it('unmarks a record whose entry was stripped, so the backfill writes it again; a bot without apps is untouched', async () => {
    await store.setRecord('bella', { ...legacy('bella'), identity: true })
    servers.bella = null
    await unmarkRecord(deps, 'bella')
    await unmarkRecord(deps, 'nobody')
    expect(store.record('bella')?.identity).toBeUndefined()
    expect(store.record('nobody')).toBeUndefined()
    const backfill = createIdentityBackfill(deps)
    backfill.onRoster(['bella'])
    await backfill.idle()
    expect(calls).toEqual(['add:bella'])
    expect(servers.bella).toEqual({ enabled: true })
    expect(store.record('bella')).toMatchObject({ identity: true, apps: { github: 'all' } })
  })

  it('fails closed when Hermes refuses the write: the old token stops working, the record stays unmarked, and a retry completes', async () => {
    await store.setRecord('bella', legacy('bella'))
    rpc.fail('mcp.servers.add', new HermesRpcError(4001, 'refused'))
    await expect(ensureIdentity(deps, 'bella')).rejects.toBeInstanceOf(HermesRpcError)
    expect(store.record('bella')?.identity).toBeUndefined()
    expect(store.record('bella')?.tokenHash).not.toBe(hashToken('old-bella'))
    expect(scheduled).toEqual([])
    rpc.handlers.set('mcp.servers.add', p => { servers[p.profile as string] = { enabled: true }; return { ok: true } })
    expect(await ensureIdentity(deps, 'bella')).toBe('done')
    expect(store.record('bella')).toMatchObject({ identity: true, tokenHash: hashToken('tok2') })
  })

  it('on a roster sync upgrades only listed, unmarked bots, once each, and retries a failure after the wait', async () => {
    await store.setRecord('default', legacy('default'))
    await store.setRecord('bella', legacy('bella'))
    await store.setRecord('ghost', legacy('ghost'))
    rest.routes.set('DELETE /api/mcp/servers/crew_apps', r => {
      if (r.query?.profile === 'bella') throw new HermesRestError(500, 'boom')
      servers[r.query?.profile ?? ''] = null
      return {}
    })
    const backfill = createIdentityBackfill(deps)
    backfill.onRoster(['default', 'bella', 'other'])
    backfill.onRoster(['default', 'bella', 'other'])
    await backfill.idle()
    expect(store.record('default')?.identity).toBe(true)
    expect(store.record('bella')?.identity).toBeUndefined()
    expect(store.record('ghost')).toEqual(legacy('ghost'))
    expect(rpc.of('mcp.servers.add').map(c => c.params.profile)).toEqual(['default'])
    rest.routes.set('DELETE /api/mcp/servers/crew_apps', r => { servers[r.query?.profile ?? ''] = null; return {} })
    now += IDENTITY_RETRY_MS - 1
    backfill.onRoster(['default', 'bella'])
    await backfill.idle()
    expect(store.record('bella')?.identity).toBeUndefined()
    now += 1
    backfill.onRoster(['default', 'bella'])
    await backfill.idle()
    expect(store.record('bella')?.identity).toBe(true)
    backfill.onRoster(['default', 'bella'])
    await backfill.idle()
    expect(rpc.of('mcp.servers.add').map(c => c.params.profile)).toEqual(['default', 'bella'])
  })
})
