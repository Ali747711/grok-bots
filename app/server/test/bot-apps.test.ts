import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AppsRefusedError, TOOLS_TTL_MS, clampIfNoApprovals, forgetBot, readBotApps, rebuildSession, setBotApps, toolsFor, type ConnectorDeps
} from '../src/connectors/bot-apps.js'
import { ComposioError, type Composio, type ToolHint } from '../src/connectors/composio.js'
import { ConnectorStore, hashToken } from '../src/connectors/store.js'
import { HermesRestError } from '../src/hermes/errors.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

const GH: ToolHint[] = [
  { slug: 'GITHUB_GET', readOnly: true, destructive: false },
  { slug: 'GITHUB_CREATE', readOnly: false, destructive: false },
  { slug: 'GITHUB_DELETE', readOnly: false, destructive: true }
]

describe('bot apps', () => {
  let dir: string
  let store: ConnectorStore
  let rpc: FakeRpc
  let rest: FakeRest
  let calls: string[]
  let now: number
  let key: string | null
  let scheduled: string[]
  let server: { enabled: boolean } | null
  let tokens: number
  let config: Record<string, unknown>
  let deps: ConnectorDeps
  const sessions: Record<string, unknown>[] = []

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'bot-apps-'))
    store = await ConnectorStore.load(join(dir, 'c.json'), () => '11111111-1111-4111-8111-111111111111')
    rpc = new FakeRpc()
    rest = new FakeRest()
    calls = []
    now = 1_000
    key = 'ak_test_key_123'
    scheduled = []
    server = null
    tokens = 0
    config = {}
    sessions.length = 0
    rpc.handlers.set('mcp.servers.add', p => { calls.push('add'); server = { enabled: true }; return p })
    rest.routes.set('GET /api/mcp/servers', () => ({ servers: server ? [{ name: 'crew_apps', ...server }] : [] }))
    rest.routes.set('GET /api/config', () => config)
    rest.routes.set('PUT /api/mcp/servers/crew_apps/enabled', r => { calls.push('enable'); server = { enabled: (r.body as { enabled: boolean }).enabled }; return {} })
    rest.routes.set('DELETE /api/mcp/servers/crew_apps', () => { calls.push('remove'); server = null; return {} })
    rest.routes.set('DELETE /api/env', () => { calls.push('env'); return {} })
    let n = 0
    const composio = {
      toolsOf: async (slug: string) => { calls.push(`tools:${slug}`); if (slug === 'nope') throw new ComposioError('not_found'); return GH },
      toolkit: async (slug: string) => ({ slug, name: 'GitHub' }),
      createSession: async (_u: string, spec: { tools: Record<string, string[]> }) => {
        n += 1; calls.push(`create:${n}`); sessions.push(spec.tools)
        return { sessionId: `sess_${n}`, mcpUrl: `https://backend.composio.dev/tool_router/sess_${n}/mcp` }
      },
      deleteSession: async (id: string) => { calls.push(`del:${id}`) }
    } as unknown as Composio
    deps = {
      bots: { rpc: rpc.call, rest: rest as never }, composio, keys: { get: () => key }, store,
      reconnector: { schedule: b => scheduled.push(b), idle: async () => undefined },
      relayUrl: b => `http://127.0.0.1:7070/mcp/${b}`, newToken: () => `tok${++tokens}`, now: () => now
    }
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('turns on GitHub Read only: read tools in the session, a token hash in the record, the server added with the relay URL', async () => {
    const view = await setBotApps(deps, 'scout', { github: 'read' })
    expect(sessions[0]).toEqual({ github: ['GITHUB_GET'] })
    expect(store.record('scout')).toMatchObject({ allowed: ['GITHUB_GET'], sessionId: 'sess_1', tokenHash: hashToken('tok1') })
    expect(rpc.params('mcp.servers.add')).toMatchObject({ profile: 'scout', bearer_token: 'tok1', config: { url: 'http://127.0.0.1:7070/mcp/scout' } })
    expect(view.apps).toEqual([{ toolkit: 'github', name: 'GitHub', level: 'read', tools: 1, capped: false }])
    expect(scheduled).toEqual([])
  })

  it('creates the new session before saving and deletes the old one after', async () => {
    await setBotApps(deps, 'scout', { github: 'read' })
    calls.length = 0
    await setBotApps(deps, 'scout', { github: 'change' })
    expect(calls.filter(c => /^(create|del)/.test(c))).toEqual(['create:2', 'del:sess_1'])
    expect(store.record('scout')?.sessionId).toBe('sess_2')
  })

  it('reconnects only when the allowed set changed and enables a disabled server instead', async () => {
    await setBotApps(deps, 'scout', { github: 'read' })
    await setBotApps(deps, 'scout', { github: 'read' })
    expect(scheduled).toEqual([])
    await setBotApps(deps, 'scout', { github: 'change' })
    expect(scheduled).toEqual(['scout'])
    server = { enabled: false }
    await setBotApps(deps, 'scout', { github: 'all' })
    expect(scheduled).toEqual(['scout'])
    expect(server).toEqual({ enabled: true })
  })

  it('re-adds a missing server with a fresh token and a new hash', async () => {
    await setBotApps(deps, 'scout', { github: 'read' })
    server = null
    await setBotApps(deps, 'scout', { github: 'read' })
    expect(rpc.of('mcp.servers.add').map(c => c.params.bearer_token)).toEqual(['tok1', 'tok2'])
    expect(store.record('scout')?.tokenHash).toBe(hashToken('tok2'))
  })

  it('replaces an existing server when the record is new, so the token matches', async () => {
    server = { enabled: true }
    await setBotApps(deps, 'scout', { github: 'read' })
    expect(calls.filter(c => /^(remove|env|add)$/.test(c))).toEqual(['remove', 'env', 'add'])
    expect(rpc.params('mcp.servers.add')).toMatchObject({ bearer_token: 'tok1' })
    expect(store.record('scout')?.tokenHash).toBe(hashToken('tok1'))
    expect(scheduled).toEqual(['scout'])
  })

  it('turns the last app off: server and env var removed, session deleted, record gone, also without a key', async () => {
    await setBotApps(deps, 'scout', { github: 'read' })
    calls.length = 0
    await setBotApps(deps, 'scout', {})
    expect(calls).toEqual(['remove', 'env', 'del:sess_1'])
    expect(store.record('scout')).toBeUndefined()
    await setBotApps(deps, 'two', { github: 'read' })
    key = null
    calls.length = 0
    await setBotApps(deps, 'two', {})
    expect(calls).toEqual(['remove', 'env'])
    expect(store.record('two')).toBeUndefined()
  })

  it('keeps the record when removing the server fails', async () => {
    await setBotApps(deps, 'scout', { github: 'read' })
    rest.routes.set('DELETE /api/mcp/servers/crew_apps', () => { throw new HermesRestError(500, 'boom') })
    await expect(setBotApps(deps, 'scout', {})).rejects.toBeInstanceOf(HermesRestError)
    expect(store.record('scout')).toBeDefined()
  })

  it('refuses no_key, level_unavailable for a bot with approvals off, and unknown_app', async () => {
    key = null
    await expect(setBotApps(deps, 'scout', { github: 'read' })).rejects.toMatchObject({ code: 'no_key' })
    key = 'ak_test_key_123'
    config = { approvals: { mode: 'off' } }
    await expect(setBotApps(deps, 'scout', { github: 'change' })).rejects.toMatchObject({ code: 'level_unavailable' })
    config = {}
    await expect(setBotApps(deps, 'scout', { nope: 'read' })).rejects.toMatchObject({ code: 'unknown_app' })
    await expect(setBotApps(deps, 'scout', { 'Bad Slug!': 'read' })).rejects.toBeInstanceOf(AppsRefusedError)
    expect(store.record('scout')).toBeUndefined()
    expect(rpc.of('mcp.servers.add')).toEqual([])
  })

  it('serializes two changes for one bot', async () => {
    await Promise.all([setBotApps(deps, 'scout', { github: 'read' }), setBotApps(deps, 'scout', { github: 'change' })])
    expect(calls.filter(c => /^(create|del)/.test(c))).toEqual(['create:1', 'create:2', 'del:sess_1'])
    expect(store.record('scout')?.apps).toEqual({ github: 'change' })
  })

  it('uses cached tools for 24 h and refetches after', async () => {
    await toolsFor(deps, 'github')
    await toolsFor(deps, 'github')
    now += TOOLS_TTL_MS - 1
    await toolsFor(deps, 'github')
    expect(calls.filter(c => c === 'tools:github')).toHaveLength(1)
    now += 1
    await toolsFor(deps, 'github')
    expect(calls.filter(c => c === 'tools:github')).toHaveLength(2)
    expect(store.name('github')).toBe('GitHub')
  })

  it('reads the view without calling Composio', async () => {
    await setBotApps(deps, 'scout', { github: 'read' })
    calls.length = 0
    config = { approvals: { mode: false } }
    const view = await readBotApps(deps, 'scout')
    expect(calls).toEqual([])
    expect(view).toMatchObject({ offered: ['read'], asks: false, keyConfigured: true, roomWritesDeclined: false })
    expect(view.apps).toHaveLength(1)
    expect((await readBotApps(deps, 'nobody')).apps).toEqual([])
  })

  it('rebuilds the session from the current apps and keeps the token hash', async () => {
    await setBotApps(deps, 'scout', { github: 'read' })
    const hash = store.record('scout')?.tokenHash
    await rebuildSession(deps, 'scout')
    expect(store.record('scout')).toMatchObject({ sessionId: 'sess_2', tokenHash: hash })
    expect(calls).toContain('del:sess_1')
    expect(scheduled).toEqual([])
  })

  it('forgets a bot: session deleted best-effort, record removed, never rejects', async () => {
    await setBotApps(deps, 'scout', { github: 'read' })
    deps = { ...deps, composio: { ...deps.composio, deleteSession: async () => { throw new ComposioError('composio_unavailable') } } as Composio }
    await expect(forgetBot(deps, 'scout')).resolves.toBeUndefined()
    expect(store.record('scout')).toBeUndefined()
    await expect(forgetBot(deps, 'scout')).resolves.toBeUndefined()
  })

  it('clamps a bot to Read only after its approvals turn off, once', async () => {
    await setBotApps(deps, 'scout', { github: 'all', slack: 'change' })
    expect(store.record('scout')?.apps).toEqual({ github: 'all', slack: 'change' })
    const asking = { approvals: { mode: 'manual' } }
    clampIfNoApprovals(deps, 'scout', asking)
    await deps.reconnector.idle('scout')
    expect(store.record('scout')?.apps).toEqual({ github: 'all', slack: 'change' })
    const off = { approvals: { mode: 'OFF' } }
    clampIfNoApprovals(deps, 'scout', off)
    clampIfNoApprovals(deps, 'scout', { approvals: { mode: false } })
    await vi.waitFor(() => expect(store.record('scout')?.apps).toEqual({ github: 'read', slack: 'read' }))
    const creates = calls.filter(c => c.startsWith('create:')).length
    clampIfNoApprovals(deps, 'scout', off)
    await new Promise(r => setTimeout(r, 20))
    expect(calls.filter(c => c.startsWith('create:')).length).toBe(creates)
    expect(creates).toBe(2)
  })
})
