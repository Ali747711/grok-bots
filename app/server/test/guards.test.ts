import type { IncomingMessage } from 'node:http'

import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { signSession } from '../src/auth/session-cookie.js'
import { isAllowedUpgrade } from '../src/http/session-guard.js'
import { HOST, ORIGIN, makeDeps } from './helpers.js'

const deps = makeDeps()
const app = createApp(deps)
const CSRF = 'csrf-token-1'
const sessionValue = signSession(deps.secrets.cookie, { sid: 'sid-1', exp: deps.now() + 60_000 })
const validCookies = `crew_session=${sessionValue}; crew_csrf=${CSRF}`

interface Opts { origin?: string | null; cookie?: string; csrf?: boolean; host?: string }

const get = (path: string, o: Opts = {}) =>
  app.request(path, { headers: { Host: o.host ?? HOST, ...(o.cookie ? { Cookie: o.cookie } : {}) } })

const post = (path: string, o: Opts = {}) =>
  app.request(path, {
    method: 'POST',
    headers: {
      Host: o.host ?? HOST,
      ...(o.origin !== undefined && o.origin !== null ? { Origin: o.origin } : {}),
      ...(o.cookie ? { Cookie: o.cookie } : {}),
      ...(o.csrf ? { 'X-Crew-CSRF': CSRF } : {})
    }
  })

describe('session guard', () => {
  it('protected route without cookie → 401 login_required', async () => {
    const res = await get('/crew/whoami')
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('login_required')
  })

  it('protected route with a valid cookie → 200 and the session id', async () => {
    const res = await get('/crew/whoami', { cookie: validCookies })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sid: 'sid-1' })
  })

  it('expired session cookie → 401', async () => {
    const expired = signSession(deps.secrets.cookie, { sid: 'old', exp: deps.now() - 1 })
    expect((await get('/crew/whoami', { cookie: `crew_session=${expired}` })).status).toBe(401)
  })

  it('public paths stay reachable without a cookie', async () => {
    expect((await get('/crew/health')).status).toBe(200)
    expect((await get('/login')).status).toBe(200)
  })

  it('admin endpoint works without Origin or CSRF (crew login CLI)', async () => {
    const res = await app.request('/crew/admin/login-ticket', {
      method: 'POST',
      headers: { Host: HOST, 'X-Crew-Admin': deps.secrets.admin.toString('hex') }
    })
    expect(res.status).toBe(200)
  })
})

describe('origin and csrf guard', () => {
  it.each([['http://evil.example'], ['null'], [null]])('POST with Origin %s → 403 bad_origin', async (origin) => {
    const res = await post('/crew/whoami', { origin, cookie: validCookies, csrf: true })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('bad_origin')
  })

  it('POST without matching CSRF header → 403 bad_csrf', async () => {
    const res = await post('/crew/whoami', { origin: ORIGIN, cookie: validCookies, csrf: false })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('bad_csrf')
  })

  it('POST with CSRF header but no csrf cookie → 403 bad_csrf', async () => {
    const res = await post('/crew/whoami', { origin: ORIGIN, cookie: `crew_session=${sessionValue}`, csrf: true })
    expect(res.status).toBe(403)
  })

  it.each([
    ['http://127.0.0.1:7070', '127.0.0.1:7070'],
    ['http://localhost:7070', 'localhost:7070']
  ])('both allowed origins pass (%s)', async (origin, host) => {
    const res = await post('/crew/whoami', { origin, host, cookie: validCookies, csrf: true })
    expect(res.status).toBe(200)
  })
})

describe('isAllowedUpgrade', () => {
  const req = (headers: Record<string, string>) => ({ headers, url: '/api/ws' }) as unknown as IncomingMessage
  const ok = { host: HOST, origin: ORIGIN, cookie: validCookies }

  it('accepts allowed Host + exact Origin + valid session', () => {
    expect(isAllowedUpgrade(req(ok), deps.config, deps.secrets.cookie, deps.now())).toBe(true)
  })

  it.each([
    ['missing Origin', { host: HOST, cookie: validCookies }],
    ['foreign Origin', { ...ok, origin: 'http://evil.example' }],
    ['missing cookie', { host: HOST, origin: ORIGIN }],
    ['foreign Host', { ...ok, host: 'evil.example:7070' }]
  ])('refuses %s', (_name, headers) => {
    expect(isAllowedUpgrade(req(headers as Record<string, string>), deps.config, deps.secrets.cookie, deps.now())).toBe(false)
  })
})
