import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import type { BotDeps } from '../src/bots/create.js'
import { HermesRestError, HermesRpcError, HermesUnavailableError } from '../src/hermes/errors.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = { Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

let rpc: FakeRpc
let rest: FakeRest
let app: ReturnType<typeof createApp>
let refreshes: number
const send = (method: string, path: string, payload?: unknown, extra: Record<string, string> = {}) =>
  app.request(path, { method, headers: { ...headers, ...extra }, ...(payload === undefined ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }) })

beforeEach(() => {
  rpc = new FakeRpc()
  rest = new FakeRest()
  refreshes = 0
  rpc.meta('scout', { title: 'Scout', shape: 'circle', color: '#111111' }, 2)
  rest.soul('scout', 'Original')
  rest.models.set('scout', { provider: 'openrouter', model: 'a/b' })
  const bots: BotDeps = { rpc: rpc.call, rest: { request: (...args: Parameters<FakeRest['request']>) => rest.request(...args) } as BotDeps['rest'], refresh: async () => { refreshes += 1 }, now: () => 1 }
  app = createApp({ ...base, bots })
})

describe('GET /crew/bots/:name', () => {
  it('returns the detail', async () => {
    const res = await send('GET', '/crew/bots/scout')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ name: 'scout', title: 'Scout', soul: 'Original', metaRevision: 2 })
  })

  it('answers 404 for a malformed or unknown name, and allows the primary', async () => {
    expect((await send('GET', '/crew/bots/Bad%20Name')).status).toBe(404)
    expect((await send('GET', '/crew/bots/ghost')).status).toBe(404)
    rpc.rows.set('default', {})
    rest.models.set('default', { provider: 'p', model: 'm' })
    expect(await (await send('GET', '/crew/bots/default')).json()).toMatchObject({ isPrimary: true, title: 'Hermes' })
  })

  it('answers 503 when hermes is offline', async () => {
    rpc.fail('profiles.list', new HermesUnavailableError())
    expect((await send('GET', '/crew/bots/scout')).status).toBe(503)
  })
})

describe('PATCH /crew/bots/:name', () => {
  it('saves and answers 200 with the detail', async () => {
    const res = await send('PATCH', '/crew/bots/scout', { title: 'New', soul: 'S', baseline: { soul: 'Original' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ status: 'saved', detail: { title: 'New', soul: 'S' } })
  })

  it('answers 409 conflict with the changed fields and current values', async () => {
    rest.soul('scout', 'Webapp edit')
    const res = await send('PATCH', '/crew/bots/scout', { soul: 'Mine', baseline: { soul: 'Original' } })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ status: 'conflict', fields: ['soul'], current: { soul: 'Webapp edit' } })
  })

  it('answers 409 confirm_required', async () => {
    rpc.otherConfigure = () => ({ ok: true, applied: {}, confirm_required: true, confirm_message: 'Costly' })
    const res = await send('PATCH', '/crew/bots/scout', { model: { provider: 'p', model: 'm' }, baseline: { model: { provider: 'openrouter', model: 'a/b' } } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ status: 'confirm_required', message: 'Costly' })
  })

  it('rejects empty and invalid patches with 400 bad_body', async () => {
    for (const payload of [{}, { title: '' }, { title: 'x'.repeat(81) }, { look: { shape: 'blob', color: '#111111' } }, { hidden: 'yes' },
      { description: 'x'.repeat(2001) }, { soul: 'x'.repeat(100_001) }, { model: { provider: '', model: 'm' } }, '{']) {
      const res = await send('PATCH', '/crew/bots/scout', payload)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_body' })
    }
    expect(rpc.of('profiles.configure')).toHaveLength(0)
  })

  it('requires a baseline for soul, description and model, naming the missing one', async () => {
    for (const [patch, field] of [
      [{ soul: 'S' }, 'soul'],
      [{ description: 'D' }, 'description'],
      [{ model: { provider: 'p', model: 'm' } }, 'model'],
      [{ soul: 'S', baseline: { description: 'x' } }, 'soul']
    ] as const) {
      const res = await send('PATCH', '/crew/bots/scout', patch)
      expect(res.status).toBe(400)
      const body = await res.json() as { error: string; message: string }
      expect(body.error).toBe('bad_body')
      expect(body.message).toContain(`baseline.${field}`)
    }
    expect(rpc.calls).toEqual([])
  })

  it('accepts a model with a null baseline and needs no baseline for title, look or hidden', async () => {
    rest.models.delete('scout')
    expect((await send('PATCH', '/crew/bots/scout', { model: { provider: 'p', model: 'm' }, baseline: { model: null } })).status).toBe(200)
    for (const patch of [{ title: 'T' }, { hidden: true }, { look: { shape: 'circle', color: '#222222' } }]) {
      expect((await send('PATCH', '/crew/bots/scout', patch)).status).toBe(200)
    }
  })

  it('answers 502 not_saved with the section', async () => {
    rpc.otherConfigure = () => ({ ok: false, applied: { description: false } })
    const res = await send('PATCH', '/crew/bots/scout', { description: 'D', baseline: { description: '' } })
    expect(res.status).toBe(502)
    expect(await res.json()).toEqual({ error: 'not_saved', section: 'description' })
  })

  it('answers 404 for an unknown bot and 502 for an unexpected failure', async () => {
    expect((await send('PATCH', '/crew/bots/ghost', { title: 'T' })).status).toBe(404)
    rest.request = async () => { throw new Error('socket hang up') }
    const res = await send('PATCH', '/crew/bots/scout', { title: 'T' })
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'hermes_error' })
  })

  it('requires the CSRF header', async () => {
    expect((await send('PATCH', '/crew/bots/scout', { title: 'T' }, { 'X-Crew-CSRF': '' })).status).toBe(403)
  })
})

describe('avatar routes', () => {
  const image = 'data:image/png;base64,AAAA'

  it('PUT sets the avatar and answers the detail', async () => {
    const res = await send('PUT', '/crew/bots/scout/avatar', { image })
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ look: { imageKind: 'photo' } })
  })

  it('DELETE clears it', async () => {
    const res = await send('DELETE', '/crew/bots/scout/avatar')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ look: { imageKind: 'shape' } })
  })

  it('rejects a gif or missing image with 400 bad_body and an oversized body with 413', async () => {
    expect((await send('PUT', '/crew/bots/scout/avatar', { image: 'data:image/gif;base64,AA' })).status).toBe(400)
    expect((await send('PUT', '/crew/bots/scout/avatar', {})).status).toBe(400)
    const res = await send('PUT', '/crew/bots/scout/avatar', { image, junk: 'x'.repeat(3 * 1024 * 1024 + 10) })
    expect(res.status).toBe(413)
    expect(await res.json()).toEqual({ error: 'too_large' })
  })

  it('maps hermes asset errors', async () => {
    for (const [code, status, error] of [[4069, 413, 'too_large'], [4068, 400, 'bad_image'], [4070, 400, 'bad_image'], [4064, 404, 'not_found']] as const) {
      rpc.fail('profiles.set_asset', new HermesRpcError(code, 'm'))
      const res = await send('PUT', '/crew/bots/scout/avatar', { image })
      expect(res.status).toBe(status)
      expect(await res.json()).toMatchObject({ error })
    }
  })
})

describe('DELETE /crew/bots/:name', () => {
  it('deletes and answers 204', async () => {
    const res = await send('DELETE', '/crew/bots/scout')
    expect(res.status).toBe(204)
    expect(rest.writes()).toEqual([{ method: 'DELETE', path: '/api/profiles/scout', timeoutMs: 60_000 }])
    expect(refreshes).toBe(1)
  })

  it('refuses the primary bot with 400 and no rest call', async () => {
    const res = await send('DELETE', '/crew/bots/default')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'cannot_delete_primary' })
    expect(rest.requests).toEqual([])
  })

  it('treats settlement_pending as success and maps a rest 404 to 404', async () => {
    rest.deleteReply = { ok: true, settlement_pending: true }
    expect((await send('DELETE', '/crew/bots/scout')).status).toBe(204)
    rest.request = async () => { throw new HermesRestError(404, 'Profile scout does not exist') }
    expect((await send('DELETE', '/crew/bots/scout')).status).toBe(404)
  })

  it('answers 503 when bots are not wired', async () => {
    const res = await createApp(base).request('/crew/bots/scout', { method: 'DELETE', headers })
    expect(res.status).toBe(503)
  })
})
