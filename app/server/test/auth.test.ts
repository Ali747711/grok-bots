import { mkdtemp, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { ensureSecret } from '../src/auth/secrets.js'
import { signSession, verifySession } from '../src/auth/session-cookie.js'
import { TicketStore } from '../src/auth/tickets.js'
import { loadConfig } from '../src/config.js'

const HOST = '127.0.0.1:7070'
const ORIGIN = 'http://127.0.0.1:7070'
const key = Buffer.alloc(32, 7)

function makeDeps(nowMs = 1_000_000) {
  return {
    config: loadConfig({ HOME: '/home/ali' }),
    secrets: { admin: Buffer.alloc(32, 1), cookie: key },
    tickets: new TicketStore(),
    now: () => nowMs
  }
}

describe('TicketStore', () => {
  it('ticket is single use and expires after 60 s', () => {
    const t = new TicketStore()
    const tk = t.mint(0)
    expect(t.redeem(tk, 59_000)).toBe(true)
    expect(t.redeem(tk, 59_001)).toBe(false)
    expect(t.redeem(t.mint(0), 60_001)).toBe(false)
  })

  it('rejects unknown tickets', () => {
    expect(new TicketStore().redeem('nope', 0)).toBe(false)
  })
})

describe('session cookie', () => {
  it('verifySession rejects tampering and expiry', () => {
    const v = signSession(key, { sid: 's1', exp: 1000 })
    expect(verifySession(key, v, 999)).toEqual({ sid: 's1', exp: 1000 })
    expect(verifySession(key, v, 1001)).toBeNull()
    expect(verifySession(key, v.slice(0, -2) + 'xx', 999)).toBeNull()
    expect(verifySession(Buffer.alloc(32, 8), v, 999)).toBeNull()
    expect(verifySession(key, undefined, 999)).toBeNull()
    expect(verifySession(key, 'garbage', 999)).toBeNull()
  })
})

describe('login routes', () => {
  let deps: ReturnType<typeof makeDeps>
  let app: ReturnType<typeof createApp>

  beforeEach(() => {
    deps = makeDeps()
    app = createApp(deps)
  })

  // `null` = send no Origin header (an `undefined` argument would fall back to the default).
  const login = (ticket: string, origin: string | null = ORIGIN) =>
    app.request('/crew/login', {
      method: 'POST',
      headers: { Host: HOST, 'Content-Type': 'application/json', ...(origin !== null ? { Origin: origin } : {}) },
      body: JSON.stringify({ ticket })
    })

  const adminTicket = (secretHex: string) =>
    app.request('/crew/admin/login-ticket', { method: 'POST', headers: { Host: HOST, 'X-Crew-Admin': secretHex } })

  it('login sets HttpOnly Strict session cookie and csrf cookie', async () => {
    const res = await login(deps.tickets.mint(deps.now()))
    expect(res.status).toBe(204)
    const cookies = res.headers.getSetCookie()
    const session = cookies.find(c => c.startsWith('crew_session='))
    const csrf = cookies.find(c => c.startsWith('crew_csrf='))
    expect(session).toMatch(/HttpOnly/i)
    expect(session).toMatch(/SameSite=Strict/i)
    expect(session).toMatch(/Max-Age=7776000/)
    expect(session).toMatch(/Path=\//)
    expect(csrf).toBeDefined()
    expect(csrf).not.toMatch(/HttpOnly/i)
    expect(csrf).toMatch(/SameSite=Strict/i)
  })

  it('session cookie verifies with the cookie secret for 90 days', async () => {
    const res = await login(deps.tickets.mint(deps.now()))
    const raw = res.headers.getSetCookie().find(c => c.startsWith('crew_session='))!
    const value = raw.split(';')[0]!.slice('crew_session='.length)
    const session = verifySession(key, value, deps.now())
    expect(session?.exp).toBe(deps.now() + 7_776_000_000)
  })

  it('concurrent redeem yields one success', async () => {
    const tk = deps.tickets.mint(deps.now())
    const results = await Promise.all([login(tk), login(tk)])
    expect(results.map(r => r.status).sort()).toEqual([204, 401])
  })

  it('rejects an invalid ticket with 401', async () => {
    expect((await login('not-a-ticket')).status).toBe(401)
  })

  it.each([['http://evil.example'], ['null'], [null]])('rejects login from Origin %s with 403', async (origin) => {
    const res = await login(deps.tickets.mint(deps.now()), origin)
    expect(res.status).toBe(403)
  })

  it('admin endpoint requires the admin secret', async () => {
    expect((await adminTicket('wrong')).status).toBe(401)
    const ok = await adminTicket(deps.secrets.admin.toString('hex'))
    expect(ok.status).toBe(200)
    expect((await ok.json()).url).toMatch(/^http:\/\/127\.0\.0\.1:7070\/login#ticket=[A-Za-z0-9_-]{43}$/)
  })

  it('admin-minted ticket logs in', async () => {
    const ok = await adminTicket(deps.secrets.admin.toString('hex'))
    const ticket = (await ok.json()).url.split('#ticket=')[1]
    expect((await login(ticket)).status).toBe(204)
  })

  it('serves the login page as uncached HTML', async () => {
    const res = await app.request('/login', { headers: { Host: HOST } })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/html/)
    expect(res.headers.get('cache-control')).toMatch(/no-store/)
  })
})

describe('ensureSecret', () => {
  it('creates a 0600 file in a 0700 dir and is stable', async () => {
    const dir = join(await mkdtemp(join(tmpdir(), 'crew-')), 'state')
    const path = join(dir, 'cookie-secret')
    const first = await ensureSecret(path)
    expect(first.length).toBe(32)
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect((await stat(dir)).mode & 0o777).toBe(0o700)
    expect((await ensureSecret(path)).equals(first)).toBe(true)
  })
})
