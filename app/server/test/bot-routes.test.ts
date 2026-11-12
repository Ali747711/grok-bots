import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import type { BotDeps } from '../src/bots/create.js'
import { HermesRpcError, HermesUnavailableError } from '../src/hermes/errors.js'
import type { SandboxDeps } from '../src/bots/sandbox.js'
import { DEFAULT_IMAGE, type Docker } from '../src/sandbox/docker.js'
import { FakeRpc } from './fake-rpc.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = {
  Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`,
  'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok'
}
const body = { name: 'scout', title: 'Researcher', mission: 'Find papers', avatar: { type: 'square', color: '#7c3aed' } }

let rpc: FakeRpc
let puts: unknown[]
let configGets: string[]
let bots: BotDeps
let current: ReturnType<typeof createApp>
const app = () => current
const post = (path: string, payload: unknown, extra: Record<string, string> = {}) =>
  app().request(path, { method: 'POST', headers: { ...headers, ...extra }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) })

beforeEach(() => {
  rpc = new FakeRpc()
  rpc.meta('default', { title: 'Hermes' }, 1)
  puts = []
  configGets = []
  bots = { rpc: rpc.call, rest: { request: async (method: string, _path: string, opts: { query?: Record<string, unknown>; body?: unknown } = {}) => {
    if (method === 'GET') { configGets.push(String(opts.query?.profile)); return {} }
    if (method === 'PUT') puts.push(opts.body)
    return { ok: true }
  } } as unknown as BotDeps['rest'], refresh: async () => undefined, now: () => 1 }
  current = createApp({ ...base, bots })
})

describe('POST /crew/bots', () => {
  it('creates a bot and answers 201 with the result', async () => {
    const res = await post('/crew/bots', body)
    expect(res.status).toBe(201)
    expect(await res.json()).toMatchObject({ name: 'scout', complete: true, steps: { profile: 'ok', look: 'ok', chat: 'ok' } })
  })

  it('accepts firstRun on create and refuses a non-boolean', async () => {
    expect((await post('/crew/bots', { ...body, firstRun: false })).status).toBe(201)
    const bad = await post('/crew/bots', { ...body, name: 'scout2', firstRun: 'yes' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'bad_body' })
  })

  it('sends sandbox false by default', async () => {
    expect((await post('/crew/bots', body)).status).toBe(201)
    expect(puts).toEqual([])
    expect((rpc.configures[0]!.ui_meta as Record<string, Record<string, unknown>>)['hermes-bots']!.sandbox).toEqual({ on: false, addedBrowserDisable: false })
  })

  describe('sandbox: true', () => {
    const withDocker = (status: string, present: boolean | Error): void => {
      const docker = { status: async () => status, imagePresent: async () => { if (present instanceof Error) throw present; return present } }
      bots = { ...bots, sandbox: { docker: docker as unknown as Docker } as unknown as SandboxDeps }
      current = createApp({ ...base, bots })
    }

    it('refuses with 409 docker_unavailable or image_missing before profiles.create', async () => {
      const refuse = async (error: string): Promise<void> => {
        const res = await post('/crew/bots', { ...body, sandbox: true })
        expect(res.status).toBe(409)
        expect(await res.json()).toEqual({ error })
        expect(rpc.methods()).toEqual([])
        expect(puts).toEqual([])
      }
      await refuse('docker_unavailable')
      withDocker('down', true)
      await refuse('docker_unavailable')
      withDocker('missing', true)
      await refuse('docker_unavailable')
      withDocker('ok', false)
      await refuse('image_missing')
      expect(configGets).toEqual(['default', 'default', 'default'])
    })

    it('creates the sandboxed bot when docker answers and the image is present', async () => {
      withDocker('ok', true)
      const res = await post('/crew/bots', { ...body, sandbox: true })
      expect(res.status).toBe(201)
      expect(puts).toEqual([{ config: { terminal: { backend: 'docker', container_memory: 3072, docker_run_as_host_user: true }, agent: { disabled_toolsets: ['browser'] } } }])
      expect(DEFAULT_IMAGE).toContain('hermes-sandbox')
    })

    it('rejects a non-boolean sandbox', async () => {
      expect((await post('/crew/bots', { ...body, sandbox: 'yes' })).status).toBe(400)
    })
  })

  it('stores the avatar with its hermes shape and colour, and rejects an unknown type', async () => {
    expect((await post('/crew/bots', body)).status).toBe(201)
    expect((rpc.configures[0]!.ui_meta as Record<string, Record<string, unknown>>)['hermes-bots']).toMatchObject({ crewAvatar: { type: 'square', color: '#7c3aed' }, shape: 'squircle', color: '#7c3aed' })
    const res = await post('/crew/bots', { ...body, name: 'other', avatar: { type: 'dragon' } })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'bad_body' })
  })

  it('writes a chosen role, accepts null, and refuses an unknown role before profiles.create', async () => {
    expect((await post('/crew/bots', { ...body, role: 'analyst' })).status).toBe(201)
    expect((rpc.configures[0]!.ui_meta as Record<string, Record<string, unknown>>)['hermes-bots']!.role).toBe('analyst')
    expect((await post('/crew/bots', { ...body, name: 'other', role: null })).status).toBe(201)
    const creates = rpc.of('profiles.create').length
    const res = await post('/crew/bots', { ...body, name: 'third', role: 'chef' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'bad_body' })
    expect(rpc.of('profiles.create')).toHaveLength(creates)
  })

  it('rejects a reserved or malformed name before calling hermes', async () => {
    for (const name of ['default', 'Scout', '-a', '']) {
      const res = await post('/crew/bots', { ...body, name })
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_name' })
    }
    expect(rpc.calls).toEqual([])
  })

  it('rejects a gif data url and other bad bodies', async () => {
    for (const payload of [
      { ...body, image: 'data:image/gif;base64,AAAA' },
      { ...body, avatar: { type: 'dragon' } },
      { ...body, avatar: { type: 'cat', color: 'red' } },
      { ...body, avatar: undefined },
      { ...body, title: 'x'.repeat(81) },
      { ...body, mission: 'x'.repeat(2001) },
      { ...body, image: 'data:image/png;base64,' + 'A'.repeat(2_700_000) },
      '{'
    ]) {
      const res = await post('/crew/bots', payload)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_body' })
    }
    expect(rpc.calls).toEqual([])
  })

  it('answers 413 for an oversized body', async () => {
    const res = await post('/crew/bots', { ...body, junk: 'x'.repeat(3 * 1024 * 1024 + 10) })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too_large' })
  })

  it('maps an existing profile to 409 name_taken', async () => {
    rpc.fail('profiles.create', new HermesRpcError(4062, "A profile named 'scout' already exists."))
    const res = await post('/crew/bots', body)
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'name_taken' })
    expect(rpc.methods()).toEqual(['profiles.create'])
  })

  it('maps another 4062 to 400 bad_name with the hermes message', async () => {
    rpc.fail('profiles.create', new HermesRpcError(4062, 'Invalid profile name'))
    const res = await post('/crew/bots', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_name', message: 'Invalid profile name' })
  })

  it('answers 503 hermes_offline when hermes is unavailable or bots are not wired', async () => {
    rpc.fail('profiles.create', new HermesUnavailableError())
    expect((await post('/crew/bots', body)).status).toBe(503)
    const res = await createApp(base).request('/crew/bots', { method: 'POST', headers, body: JSON.stringify(body) })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'hermes_offline' })
  })

  it('answers 502 hermes_error for a timeout or dropped socket and never crashes', async () => {
    rpc.fail('profiles.create', new Error('request timed out after 120s: profiles.create'))
    const res = await post('/crew/bots', body)
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'hermes_error', message: 'request timed out after 120s: profiles.create' })
  })

  it('refuses a second create for the same name in flight', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    rpc.handlers.set('profiles.create', () => gate.then(() => { rpc.rows.set('scout', {}); return { ok: true } }))
    const first = post('/crew/bots', body)
    await new Promise(resolve => setTimeout(resolve, 10))
    const second = await post('/crew/bots', body)
    expect(second.status).toBe(409)
    expect(await second.json()).toEqual({ error: 'in_progress' })
    release()
    expect((await first).status).toBe(201)
  })

  it('requires the CSRF header', async () => {
    const res = await app().request('/crew/bots', { method: 'POST', headers: { ...headers, 'X-Crew-CSRF': '' }, body: JSON.stringify(body) })
    expect(res.status).toBe(403)
  })
})

describe('POST /crew/bots/:name/finish', () => {
  it('finishes a bot with no look', async () => {
    rpc.rows.set('scout', {})
    const res = await post('/crew/bots/scout/finish', {})
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'scout', complete: true, steps: { look: 'ok', chat: 'ok' } })
  })

  it('passes a valid avatar to the meta patch as crewAvatar', async () => {
    rpc.rows.set('scout', {})
    const res = await post('/crew/bots/scout/finish', { avatar: { type: 'cat', color: '#112233' } })
    expect(res.status).toBe(200)
    expect((rpc.configures[0]!.ui_meta as Record<string, Record<string, unknown>>)['hermes-bots']).toMatchObject({ crewAvatar: { type: 'cat', color: '#112233' } })
  })

  it('rejects an unknown avatar type or a bad hex with 400', async () => {
    rpc.rows.set('scout', {})
    expect((await post('/crew/bots/scout/finish', { avatar: { type: 'dragon' } })).status).toBe(400)
    expect((await post('/crew/bots/scout/finish', { avatar: { type: 'cat', color: 'red' } })).status).toBe(400)
    expect((await post('/crew/bots/scout/finish', { avatar: { type: 'cat', color: '#12345' } })).status).toBe(400)
    expect(rpc.configures).toHaveLength(0)
  })

  it('refuses to finish the primary bot before any hermes call', async () => {
    const res = await post('/crew/bots/default/finish', {})
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'cannot_finish_primary' })
    expect(rpc.calls).toEqual([])
  })

  it('answers 404 for an unknown or malformed name', async () => {
    expect((await post('/crew/bots/ghost/finish', {})).status).toBe(404)
    expect((await post('/crew/bots/Bad%20Name/finish', {})).status).toBe(404)
  })

  it('rejects a bad body with 400 and an oversized one with 413', async () => {
    rpc.rows.set('scout', {})
    expect((await post('/crew/bots/scout/finish', { image: 'data:image/gif;base64,AA' })).status).toBe(400)
    expect((await post('/crew/bots/scout/finish', { junk: 'x'.repeat(3 * 1024 * 1024 + 10) })).status).toBe(413)
  })

  it('answers 503 when hermes is unavailable', async () => {
    rpc.fail('profiles.list', new HermesUnavailableError())
    expect((await post('/crew/bots/scout/finish', {})).status).toBe(503)
  })
})
