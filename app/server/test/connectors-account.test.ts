import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AlreadyConnectedError, SIGN_IN_TIMEOUT_MS, disconnect, expirePending, listApps, pollConnect,
  removeKey, resumeAll, saveKey, startConnect
} from '../src/connectors/account.js'
import type { ConnectorDeps } from '../src/connectors/bot-apps.js'
import { ComposioError, type AccountStatus, type Composio } from '../src/connectors/composio.js'
import { KeyStore } from '../src/connectors/key.js'
import { ConnectorStore, hashToken, type BotRecord } from '../src/connectors/store.js'
import { log } from '../src/log.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

const KEY = 'ak_test_key_123'
const record = (apps: BotRecord['apps']): BotRecord => ({
  apps, counts: {}, sessionId: 's', mcpUrl: 'https://backend.composio.dev/x', allowed: [], tokenHash: hashToken('t')
})

describe('connector accounts', () => {
  let dir: string
  let store: ConnectorStore
  let rest: FakeRest
  let rpc: FakeRpc
  let calls: string[]
  let now: number
  let key: string | null
  let accounts: { id: string; toolkit: string; status: AccountStatus }[]
  let status: AccountStatus
  let deps: ConnectorDeps
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined)
    dir = await mkdtemp(join(tmpdir(), 'accounts-'))
    store = await ConnectorStore.load(join(dir, 'c.json'), () => '11111111-1111-4111-8111-111111111111')
    rest = new FakeRest()
    rpc = new FakeRpc()
    calls = []
    now = 1_000
    key = KEY
    accounts = []
    status = 'pending'
    rest.routes.set('PUT /api/mcp/servers/crew_apps/enabled', r => { calls.push(`enabled:${(r.body as { profile: string; enabled: boolean }).profile}:${(r.body as { enabled: boolean }).enabled}`); return {} })
    const composio = {
      accounts: async () => accounts,
      account: async (id: string) => ({ id, toolkit: 'github', status }),
      toolkit: async (slug: string) => ({ slug, name: 'GitHub' }),
      managedAuthConfig: async (slug: string) => { calls.push(`auth:${slug}`); return 'ac_1' },
      link: async (ac: string, user: string) => { calls.push(`link:${ac}:${user}`); return { redirectUrl: 'https://connect.composio.dev/x', accountId: 'ca_1' } },
      deleteAccount: async (id: string) => { calls.push(`delete:${id}`) },
      checkKey: async (k: string) => { calls.push('check'); if (k === 'bad_key_000') throw new ComposioError('key_rejected') }
    } as unknown as Composio
    deps = {
      bots: { rpc: rpc.call, rest: rest as never }, composio, keys: { get: () => key }, store,
      reconnector: { schedule: () => undefined, idle: async () => undefined },
      relayUrl: b => `http://127.0.0.1:7070/mcp/${b}`, newToken: () => 'tok', now: () => now
    }
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it("lists this user's apps with names, status and the bots that use each toolkit", async () => {
    await store.setName('github', 'GitHub')
    await store.setRecord('scout', record({ github: 'read' }))
    await store.setRecord('anna', record({ github: 'change', slack: 'read' }))
    accounts = [{ id: 'ca_1', toolkit: 'github', status: 'connected' }, { id: 'ca_2', toolkit: 'notion', status: 'pending' }]
    expect(await listApps(deps)).toEqual({
      apps: [{ id: 'ca_1', toolkit: 'github', name: 'GitHub', status: 'connected' }, { id: 'ca_2', toolkit: 'notion', name: 'notion', status: 'pending' }],
      usage: { github: ['anna', 'scout'], slack: ['anna'] }
    })
  })

  it('starts a sign-in with the managed auth config and records it as pending', async () => {
    expect(await startConnect(deps, 'github')).toEqual({ redirectUrl: 'https://connect.composio.dev/x', connectionId: 'ca_1' })
    expect(calls).toEqual(['auth:github', 'link:ac_1:11111111-1111-4111-8111-111111111111'])
    expect(store.pending()).toEqual([{ id: 'ca_1', toolkit: 'github', startedAt: 1_000 }])
    expect(store.name('github')).toBe('GitHub')
  })

  it('refuses to connect an app that is already connected', async () => {
    accounts = [{ id: 'ca_0', toolkit: 'github', status: 'connected' }]
    await expect(startConnect(deps, 'github')).rejects.toBeInstanceOf(AlreadyConnectedError)
    expect(calls).toEqual([])
    expect(store.pending()).toEqual([])
  })

  it('rebuilds the sessions of bots that use the app when a sign-in turns connected, not on the sweep', async () => {
    await store.setRecord('scout', record({ github: 'read' }))
    await store.setRecord('anna', record({ slack: 'read' }))
    const built: string[] = []
    const composio = {
      ...deps.composio,
      toolsOf: async () => [{ slug: 'GITHUB_GET', readOnly: true, destructive: false }],
      createSession: async () => { built.push('s'); return { sessionId: 's2', mcpUrl: 'https://backend.composio.dev/tool_router/s/mcp' } },
      deleteSession: async () => undefined
    } as unknown as Composio
    const d = { ...deps, composio }
    status = 'connected'
    await store.addPending({ id: 'ca_old', toolkit: 'github', startedAt: 1_000 })
    now = 1_000 + SIGN_IN_TIMEOUT_MS + 1
    await expirePending(d)
    await new Promise(r => setTimeout(r, 20))
    expect(built).toEqual([])
    await store.addPending({ id: 'ca_new', toolkit: 'github', startedAt: now })
    expect(await pollConnect(d, 'ca_new')).toBe('connected')
    await vi.waitFor(() => expect(built).toEqual(['s']))
    expect(store.record('scout')?.sessionId).toBe('s2')
    expect(store.record('anna')?.sessionId).toBe('s')
  })

  it('reports connected, failed and pending, and expires a sign-in after 10 minutes by deleting the account', async () => {
    await expect(pollConnect(deps, 'ca_x')).rejects.toMatchObject({ code: 'not_found' })
    await store.addPending({ id: 'ca_1', toolkit: 'github', startedAt: 1_000 })
    expect(await pollConnect(deps, 'ca_1')).toBe('pending')
    expect(store.pending()).toHaveLength(1)
    status = 'connected'
    expect(await pollConnect(deps, 'ca_1')).toBe('connected')
    expect(store.pending()).toEqual([])
    expect(calls).toEqual([])
    await store.addPending({ id: 'ca_2', toolkit: 'github', startedAt: 1_000 })
    status = 'failed'
    expect(await pollConnect(deps, 'ca_2')).toBe('failed')
    expect(calls).toEqual(['delete:ca_2'])
    expect(store.pending()).toEqual([])
    await store.addPending({ id: 'ca_3', toolkit: 'github', startedAt: 1_000 })
    status = 'pending'
    now = 1_000 + SIGN_IN_TIMEOUT_MS + 1
    expect(await pollConnect(deps, 'ca_3')).toBe('expired')
    expect(calls).toEqual(['delete:ca_2', 'delete:ca_3'])
    expect(store.pending()).toEqual([])
  })

  it('expires abandoned sign-ins from the sweep, also after a restart', async () => {
    await store.addPending({ id: 'ca_old', toolkit: 'github', startedAt: 1_000 })
    await store.addPending({ id: 'ca_new', toolkit: 'notion', startedAt: 1_000 + SIGN_IN_TIMEOUT_MS })
    const reloaded = await ConnectorStore.load(join(dir, 'c.json'), () => 'x')
    now = 1_000 + SIGN_IN_TIMEOUT_MS + 5
    const restarted = { ...deps, store: reloaded }
    key = null
    await expirePending(restarted)
    expect(calls).toEqual([])
    key = KEY
    await expirePending(restarted)
    expect(calls).toEqual(['delete:ca_old'])
    expect(reloaded.pending().map(p => p.id)).toEqual(['ca_new'])
  })

  it('disconnects: deletes the account first, then removes the app from every bot that had it', async () => {
    accounts = [{ id: 'ca_1', toolkit: 'github', status: 'connected' }]
    await store.setRecord('scout', record({ github: 'read' }))
    await store.setRecord('anna', record({ notion: 'read' }))
    await store.setRecord('bad', record({ github: 'read' }))
    const original = deps.composio.deleteAccount
    deps = { ...deps, composio: { ...deps.composio, deleteAccount: async (id: string) => { await original(id); expect(store.record('scout')?.apps).toEqual({ github: 'read' }); accounts = accounts.filter(a => a.id !== id) } } as Composio }
    rest.routes.set('GET /api/mcp/servers', () => ({ servers: [] }))
    rest.routes.set('DELETE /api/env', () => ({}))
    // Removing the app from 'bad' fails; the rest must still go on.
    rest.routes.set('DELETE /api/mcp/servers/crew_apps', r => {
      if ((r.query as { profile: string } | undefined)?.profile === 'bad') throw new Error('hermes down')
      return {}
    })
    await expect(disconnect(deps, 'nope')).rejects.toMatchObject({ code: 'not_found' })
    await disconnect(deps, 'ca_1')
    expect(calls).toEqual(['delete:ca_1'])
    expect(store.record('scout')).toBeUndefined()
    expect(store.record('anna')?.apps).toEqual({ notion: 'read' })
    expect(store.record('bad')?.apps).toEqual({ github: 'read' })
    expect(warn).toHaveBeenCalledWith('removing a disconnected app failed', expect.objectContaining({ bot: 'bad' }))
  })

  it('saving a key checks it first and never saves a rejected key', async () => {
    const keys = await KeyStore.load(join(dir, 'keys', 'composio-key'))
    await expect(saveKey(deps, keys, 'bad_key_000')).rejects.toMatchObject({ code: 'key_rejected' })
    expect(keys.get()).toBeNull()
    await expect(stat(join(dir, 'keys', 'composio-key'))).rejects.toThrow()
    await saveKey(deps, keys, KEY)
    expect(keys.get()).toBe(KEY)
    expect(await readFile(join(dir, 'keys', 'composio-key'), 'utf8')).toBe(`${KEY}\n`)
  })

  it('runs overlapping saves one at a time', async () => {
    const keys = await KeyStore.load(join(dir, 'keys', 'composio-key'))
    let open = 0
    let peak = 0
    const save = keys.save.bind(keys)
    keys.save = async k => { open += 1; peak = Math.max(peak, open); await save(k); open -= 1 }
    await Promise.all([saveKey(deps, keys, 'first_key_1'), saveKey(deps, keys, 'second_key_2')])
    expect(peak).toBe(1)
    expect(keys.get()).toBe('second_key_2')
  })

  it("removing the key disables every bot's server, keeps the records and deletes the file", async () => {
    const file = join(dir, 'keys', 'composio-key')
    await mkdir(join(dir, 'keys'))
    await writeFile(file, `${KEY}\n`)
    const keys = await KeyStore.load(file)
    const live: ConnectorDeps = { ...deps, keys }
    await store.setRecord('scout', record({ github: 'read' }))
    await store.setRecord('anna', record({ github: 'read' }))
    let seenNull = false
    rest.routes.set('PUT /api/mcp/servers/crew_apps/enabled', r => {
      seenNull = keys.get() === null
      if ((r.body as { profile: string }).profile === 'scout') throw new Error('down')
      calls.push(`enabled:${(r.body as { profile: string }).profile}:false`)
      return {}
    })
    await removeKey(live, keys)
    expect(seenNull).toBe(true)
    expect(calls).toEqual(['enabled:anna:false'])
    expect(store.bots().sort()).toEqual(['anna', 'scout'])
    await expect(stat(file)).rejects.toThrow()
    expect(warn).toHaveBeenCalledWith('pausing a bot failed', expect.objectContaining({ bot: 'scout' }))
  })

  it("resuming rebuilds each bot's session and enables its server, logging a failed bot and going on", async () => {
    await store.setRecord('scout', record({ github: 'read' }))
    await store.setRecord('anna', record({ github: 'read' }))
    const built: string[] = []
    let n = 0
    const composio = {
      ...deps.composio,
      toolsOf: async () => [{ slug: 'GITHUB_GET', readOnly: true, destructive: false }],
      toolkit: async (slug: string) => ({ slug, name: 'GitHub' }),
      createSession: async () => {
        n += 1
        if (n === 1) throw new ComposioError('composio_unavailable')
        built.push(`s${n}`)
        return { sessionId: `s${n}`, mcpUrl: 'https://backend.composio.dev/tool_router/s/mcp' }
      },
      deleteSession: async () => undefined
    } as unknown as Composio
    await resumeAll({ ...deps, composio })
    expect(built).toHaveLength(1)
    expect(calls).toEqual(['enabled:scout:true', 'enabled:anna:true'])
    expect(warn).toHaveBeenCalledWith('resuming a bot failed', expect.objectContaining({ bot: 'scout' }))
  })
  it('keeps every bot app when another account of the toolkit is still connected, and drops the pending entry', async () => {
    accounts = [{ id: 'ca_1', toolkit: 'github', status: 'connected' }, { id: 'ca_2', toolkit: 'github', status: 'failed' }]
    await store.setRecord('scout', record({ github: 'read' }))
    await store.addPending({ id: 'ca_2', toolkit: 'github', startedAt: 1_000 })
    const original = deps.composio.accounts
    deps = { ...deps, composio: { ...deps.composio, deleteAccount: async (id: string) => { calls.push(`delete:${id}`); accounts = accounts.filter(a => a.id !== id) }, accounts: original } as Composio }
    await disconnect(deps, 'ca_2')
    expect(calls).toEqual(['delete:ca_2'])
    expect(store.record('scout')?.apps).toEqual({ github: 'read' })
    expect(store.pending()).toEqual([])
  })

  it('strips the app from bots when the last connected account goes, and drops the pending entry', async () => {
    accounts = [{ id: 'ca_1', toolkit: 'github', status: 'connected' }]
    await store.setRecord('scout', record({ github: 'read' }))
    await store.addPending({ id: 'ca_1', toolkit: 'github', startedAt: 1_000 })
    deps = { ...deps, composio: { ...deps.composio, deleteAccount: async (id: string) => { accounts = accounts.filter(a => a.id !== id) } } as Composio }
    rest.routes.set('GET /api/mcp/servers', () => ({ servers: [] }))
    rest.routes.set('DELETE /api/env', () => ({}))
    rest.routes.set('DELETE /api/mcp/servers/crew_apps', () => ({}))
    await disconnect(deps, 'ca_1')
    expect(store.record('scout')).toBeUndefined()
    expect(store.pending()).toEqual([])
  })

  it('enables a bot whose session rebuild failed', async () => {
    await store.setRecord('scout', record({ github: 'read' }))
    const composio = {
      ...deps.composio,
      toolsOf: async () => [{ slug: 'GITHUB_GET', readOnly: true, destructive: false }],
      createSession: async () => { throw new ComposioError('composio_unavailable') },
      deleteSession: async () => undefined
    } as unknown as Composio
    await resumeAll({ ...deps, composio })
    expect(calls).toEqual(['enabled:scout:true'])
    expect(warn).toHaveBeenCalledWith('resuming a bot failed', expect.objectContaining({ bot: 'scout' }))
  })
})
