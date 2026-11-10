import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import type { BotDeps } from '../src/bots/create.js'
import { OFFERED_TOOLSETS } from '../src/bots/toolsets.js'
import { FakeRpc } from './fake-rpc.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = { Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

type Obj = Record<string, unknown>
let rpc: FakeRpc
let config: Obj
/** Names Hermes's own Toolsets tab turned off (platform_toolsets.cli), outside agent.disabled_toolsets. */
let platformOff: Set<string>
let calls: { method: string; path: string; opts: Obj }[]
let app: ReturnType<typeof createApp>

const plain = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
const merge = (into: Obj, patch: Obj): Obj => {
  const out = { ...into }
  for (const [k, v] of Object.entries(patch)) out[k] = plain(v) && plain(out[k]) ? merge(out[k] as Obj, v) : v
  return out
}
const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })
const disabled = (): unknown[] => ((config.agent as Obj | undefined)?.disabled_toolsets as unknown[] | undefined) ?? []
const configWrites = () => calls.filter(c => c.method === 'PUT' && c.path === '/api/config')
const toolsetWrites = () => calls.filter(c => c.method === 'PUT' && c.path.startsWith('/api/tools/toolsets/'))

beforeEach(() => {
  rpc = new FakeRpc()
  rpc.meta('scout', { title: 'Scout' }, 1)
  rpc.meta('default', { title: 'Hermes' }, 1)
  config = {}
  platformOff = new Set()
  calls = []
  const rest = {
    request: async (method: string, path: string, opts: Obj = {}) => {
      calls.push({ method, path, opts })
      if (path === '/api/config') {
        if (method === 'GET') return structuredClone(config)
        config = merge(config, (opts.body as { config: Obj }).config)
        return { ok: true }
      }
      if (path === '/api/tools/toolsets' && method === 'GET') {
        return [...OFFERED_TOOLSETS, 'clarify'].map(name => ({
          name, label: name, description: '', platform: 'cli', configured: true,
          enabled: !disabled().includes(name) && !platformOff.has(name)
        }))
      }
      if (path.startsWith('/api/tools/toolsets/') && method === 'PUT') {
        const name = decodeURIComponent(path.slice('/api/tools/toolsets/'.length))
        platformOff.delete(name)
        return { ok: true, name, enabled: true }
      }
      throw new Error(`unscripted ${method} ${path}`)
    }
  }
  const bots: BotDeps = { rpc: rpc.call, rest: rest as unknown as BotDeps['rest'], refresh: async () => undefined, now: () => 1 }
  app = createApp({ ...base, bots })
})

describe('toolset routes', () => {
  it('GET maps the REST rows for that profile', async () => {
    config = { agent: { disabled_toolsets: ['tts'] } }
    const res = await send('GET', '/crew/bots/scout/toolsets')
    expect(res.status).toBe(200)
    const body = await res.json() as { name: string; enabled: boolean }[]
    expect(body.map(v => v.name)).toEqual([...OFFERED_TOOLSETS])
    expect(body.find(v => v.name === 'tts')?.enabled).toBe(false)
    expect(calls.find(c => c.path === '/api/tools/toolsets')?.opts.query).toEqual({ profile: 'scout' })
  })

  it('GET works for the primary (read-only)', async () => {
    const res = await send('GET', '/crew/bots/default/toolsets')
    expect(res.status).toBe(200)
    expect(Array.isArray(await res.json())).toBe(true)
  })

  it('PUT off writes the whole disabled list with the name added', async () => {
    config = { agent: { disabled_toolsets: ['tts'] } }
    const res = await send('PUT', '/crew/bots/scout/toolsets', { name: 'vision', enabled: false })
    expect(res.status).toBe(200)
    expect(configWrites().map(c => c.opts.body)).toEqual([{ config: { agent: { disabled_toolsets: ['tts', 'vision'] } } }])
    expect((await res.json() as { name: string; enabled: boolean }[]).find(v => v.name === 'vision')?.enabled).toBe(false)
  })

  it('PUT on removes the name from the list', async () => {
    config = { agent: { disabled_toolsets: ['tts', 'vision'] } }
    const res = await send('PUT', '/crew/bots/scout/toolsets', { name: 'vision', enabled: true })
    expect(res.status).toBe(200)
    expect(disabled()).toEqual(['tts'])
    expect(toolsetWrites()).toHaveLength(0)
  })

  it("turns on a toolset still off after the list write through Hermes's toolset route", async () => {
    platformOff.add('vision')
    const res = await send('PUT', '/crew/bots/scout/toolsets', { name: 'vision', enabled: true })
    expect(res.status).toBe(200)
    expect(toolsetWrites()).toHaveLength(1)
    expect(toolsetWrites()[0]).toMatchObject({ path: '/api/tools/toolsets/vision', opts: { body: { enabled: true, profile: 'scout' } } })
    expect((await res.json() as { name: string; enabled: boolean }[]).find(v => v.name === 'vision')?.enabled).toBe(true)
  })

  it('refuses browser while sandboxed with 409 toolset_locked and writes nothing', async () => {
    config = { terminal: { backend: 'docker' } }
    const res = await send('PUT', '/crew/bots/scout/toolsets', { name: 'browser', enabled: false })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'toolset_locked' })
    expect(configWrites()).toHaveLength(0)
    expect(toolsetWrites()).toHaveLength(0)
  })

  it('refuses clarify and an unknown name with 400 unknown_toolset', async () => {
    for (const name of ['clarify', 'nonsense']) {
      const res = await send('PUT', '/crew/bots/scout/toolsets', { name, enabled: false })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'unknown_toolset' })
    }
    expect(configWrites()).toHaveLength(0)
  })

  it('refuses the primary with primary_not_supported before any read', async () => {
    const res = await send('PUT', '/crew/bots/default/toolsets', { name: 'vision', enabled: false })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'primary_not_supported' })
    expect(calls).toHaveLength(0)
  })

  it('refuses a bad body with 400 bad_body', async () => {
    for (const body of [{ name: 'Vision!', enabled: false }, { name: 'vision' }, { name: 'vision', enabled: true, extra: 1 }]) {
      const res = await send('PUT', '/crew/bots/scout/toolsets', body)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_body' })
    }
  })

  it("a user's browser write clears a stale addedBrowserDisable", async () => {
    rpc.meta('scout', { title: 'Scout', sandbox: { on: false, addedBrowserDisable: true } }, 1)
    config = { agent: { disabled_toolsets: ['browser'] } }
    const res = await send('PUT', '/crew/bots/scout/toolsets', { name: 'browser', enabled: true })
    expect(res.status).toBe(200)
    expect(disabled()).toEqual([])
    expect(rpc.rows.get('scout')?.meta?.sandbox).toEqual({ on: false, addedBrowserDisable: false })
  })

  it('answers 404 for an unknown bot', async () => {
    expect((await send('GET', '/crew/bots/ghost/toolsets')).status).toBe(404)
  })
})
