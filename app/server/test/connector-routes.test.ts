import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import { AlreadyConnectedError } from '../src/connectors/account.js'
import { AppsRefusedError, type ConnectorDeps } from '../src/connectors/bot-apps.js'
import { ComposioError, type Composio } from '../src/connectors/composio.js'
import { KeyStore } from '../src/connectors/key.js'
import { ConnectorStore } from '../src/connectors/store.js'
import { HermesRestError, HermesUnavailableError } from '../src/hermes/errors.js'
import { connectorFailure } from '../src/http/connector-routes.js'
import { log } from '../src/log.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const KEY = 'ak_test_key_123'
const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = { Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

describe('connector routes', () => {
  let dir: string
  let keys: KeyStore
  let store: ConnectorStore
  let rpc: FakeRpc
  let rest: FakeRest
  let checkKey: (k: string) => Promise<void>
  let logged: unknown[]
  let app: ReturnType<typeof createApp>
  const send = (method: string, path: string, payload?: unknown) =>
    app.request(path, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })

  beforeEach(async () => {
    logged = []
    for (const level of ['warn', 'error', 'info'] as const) vi.spyOn(log, level).mockImplementation((...a: unknown[]) => { logged.push(a) })
    dir = await mkdtemp(join(tmpdir(), 'conn-routes-'))
    keys = await KeyStore.load(join(dir, 'key'))
    store = await ConnectorStore.load(join(dir, 'c.json'), () => '11111111-1111-4111-8111-111111111111')
    rpc = new FakeRpc()
    rpc.meta('scout', { title: 'Scout' }, 1)
    rpc.meta('default', { title: 'Hermes' }, 1)
    rest = new FakeRest()
    rest.routes.set('GET /api/config', () => ({}))
    rest.routes.set('GET /api/mcp/servers', () => ({ servers: [] }))
    rest.routes.set('POST /api/env', () => ({}))
    checkKey = async () => undefined
    const composio = {
      checkKey: (k: string) => checkKey(k),
      searchToolkits: async (s: string) => [{ slug: 'github', name: `GitHub ${s}` }],
      accounts: async () => []
    } as unknown as Composio
    const connectors: ConnectorDeps = {
      bots: { rpc: rpc.call, rest: rest as never }, composio, keys, store,
      reconnector: { schedule: () => undefined, idle: async () => undefined },
      relayUrl: b => `http://127.0.0.1:7070/mcp/${b}`, newToken: () => 'tok', now: () => 1
    }
    app = createApp({ ...base, connectors: { connectors, keys } })
  })
  afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

  it('GET key answers only {configured}', async () => {
    const body = await (await send('GET', '/crew/connectors/key')).json() as Record<string, unknown>
    expect(Object.keys(body)).toEqual(['configured'])
    expect(body.configured).toBe(false)
  })

  it('PUT key: 200, 400 bad_body for a malformed key, 409 key_rejected, 502 composio_unavailable; the key is in no reply or log', async () => {
    const replies: string[] = []
    const take = async (res: Response) => { const text = await res.text(); replies.push(text); return { status: res.status, body: JSON.parse(text) as unknown } }
    expect(await take(await send('PUT', '/crew/connectors/key', { key: 'short' }))).toEqual({ status: 400, body: { error: 'bad_body' } })
    expect(await take(await send('PUT', '/crew/connectors/key', { key: KEY, extra: 1 }))).toEqual({ status: 400, body: { error: 'bad_body' } })
    checkKey = async () => { throw new ComposioError('key_rejected') }
    expect(await take(await send('PUT', '/crew/connectors/key', { key: KEY }))).toEqual({ status: 409, body: { error: 'key_rejected' } })
    checkKey = async () => { throw new ComposioError('composio_unavailable') }
    expect(await take(await send('PUT', '/crew/connectors/key', { key: KEY }))).toEqual({ status: 502, body: { error: 'composio_unavailable' } })
    expect(keys.get()).toBeNull()
    checkKey = async () => undefined
    expect(await take(await send('PUT', '/crew/connectors/key', { key: KEY }))).toEqual({ status: 200, body: { configured: true } })
    expect(keys.get()).toBe(KEY)
    expect(replies.join()).not.toContain(KEY)
    expect(JSON.stringify(logged)).not.toContain(KEY)
    expect((await send('DELETE', '/crew/connectors/key')).status).toBe(204)
    expect(keys.get()).toBeNull()
  })

  it('maps each error to its code with no message field', () => {
    const cases: [unknown, number, string][] = [
      [new ComposioError('no_key'), 409, 'no_key'],
      [new ComposioError('key_rejected'), 409, 'key_rejected'],
      [new ComposioError('composio_unavailable'), 502, 'composio_unavailable'],
      [new ComposioError('not_found'), 404, 'not_found'],
      [new AppsRefusedError('level_unavailable'), 409, 'level_unavailable'],
      [new AppsRefusedError('unknown_app'), 400, 'unknown_app'],
      [new AppsRefusedError('no_key'), 409, 'no_key'],
      [new ComposioError('app_unsupported'), 409, 'app_unsupported'],
      [new AlreadyConnectedError(), 409, 'already_connected'],
      [new HermesUnavailableError(), 503, 'hermes_offline'],
      [new HermesRestError(404, 'x'), 404, 'not_found'],
      [new Error(`leaks ${KEY}`), 502, 'apps_failed']
    ]
    for (const [error, status, code] of cases) {
      expect(connectorFailure(error, 'r')).toEqual({ status, body: { error: code } })
    }
    expect(JSON.stringify(logged)).not.toContain(KEY)
  })

  it('validates slugs and ids at the route before anything runs', async () => {
    expect((await send('POST', '/crew/connectors/connect', { toolkit: 'Bad Slug' })).status).toBe(400)
    expect((await send('GET', '/crew/connectors/connect/bad%20id')).status).toBe(400)
    expect((await send('DELETE', '/crew/connectors/apps/' + 'a'.repeat(65))).status).toBe(400)
    expect((await send('GET', '/crew/connectors/toolkits?search=' + 'a'.repeat(61))).status).toBe(400)
    expect((await send('GET', '/crew/connectors/toolkits?search=%20git%20')).status).toBe(200)
    expect(store.pending()).toEqual([])
  })

  it('PUT bot apps validates the body and answers the view; 404 for an unknown bot', async () => {
    expect((await send('PUT', '/crew/bots/scout/apps', { 'Bad Slug': 'read' })).status).toBe(400)
    expect((await send('PUT', '/crew/bots/scout/apps', { github: 'always' })).status).toBe(400)
    const many = Object.fromEntries(Array.from({ length: 21 }, (_v, i) => [`app${i}`, 'read']))
    expect((await send('PUT', '/crew/bots/scout/apps', many)).status).toBe(400)
    expect((await send('PUT', '/crew/bots/ghost/apps', {})).status).toBe(404)
    expect((await send('GET', '/crew/bots/ghost/apps')).status).toBe(404)
    const res = await send('PUT', '/crew/bots/scout/apps', {})
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ apps: [], keyConfigured: false })
    expect((await send('PUT', '/crew/bots/default/apps', {})).status).toBe(200)
    expect((await send('PUT', '/crew/bots/scout/apps', { github: 'read' })).status).toBe(409)
    expect((await send('GET', '/crew/bots/scout/apps')).status).toBe(200)
  })

  it('answers 503 apps_unavailable when connectors are off', async () => {
    app = createApp({ ...base })
    for (const [method, path] of [['GET', '/crew/connectors/key'], ['GET', '/crew/connectors/apps'], ['GET', '/crew/bots/scout/apps'], ['PUT', '/crew/bots/scout/apps']] as const) {
      const res = await send(method, path, method === 'PUT' ? {} : undefined)
      expect([res.status, await res.json()]).toEqual([503, { error: 'apps_unavailable' }])
    }
  })
})
