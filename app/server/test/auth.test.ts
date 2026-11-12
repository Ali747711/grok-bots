import { createHash } from 'node:crypto'
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

describe('login page style', () => {
  const CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
  const page = async () => {
    const res = await createApp(makeDeps()).request('/login', { headers: { Host: HOST } })
    return { res, html: await res.text() }
  }
  /** The rules inside the one `@media (prefers-color-scheme: dark)` block. */
  const darkBlock = (html: string): string => {
    const open = html.indexOf('@media (prefers-color-scheme: dark) {')
    expect(open).toBeGreaterThan(-1)
    return html.slice(open, html.indexOf('</style>'))
  }

  it('serves the new tokens in both schemes with the ticket script and the unchanged CSP', async () => {
    const { res, html } = await page()
    // Light: canvas, card and text, with the panel shadow copied from docs/ui2/tokens.md.
    for (const value of ['oklch(0.955 0 0)', 'oklch(0.995 0 0)', 'oklch(0.145 0 0)', 'border-radius: 24px']) expect(html).toContain(value)
    expect(html).toContain('0 1px 2px oklch(0 0 0 / 5%), 0 8px 24px -8px oklch(0 0 0 / 10%)')
    // Dark: its own canvas, card and text, and no shadow.
    const dark = darkBlock(html)
    for (const value of ['oklch(0.145 0 0)', 'oklch(0.205 0 0)', 'oklch(0.985 0 0)', 'box-shadow: none']) expect(dark).toContain(value)
    // Nothing of the Sky style is left: no hex or rgb colour, no gradient, no lime pill.
    for (const old of ['#d6f55a', '#2a8af0', '#4ea4f6', '#bcdcfb', 'gradient(', 'rgba(', 'class="pill"']) expect(html).not.toContain(old)
    expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(res.headers.get('Content-Security-Policy')).toBe(CSP)
  })

  it('keeps the ticket script byte for byte and adds no other script', async () => {
    const { html } = await page()
    const scripts = html.match(/<script>[\s\S]*?<\/script>/g) ?? []
    expect(scripts).toHaveLength(1)
    expect(createHash('sha256').update(scripts[0]!).digest('hex')).toBe('4198d05cd1a09965367f70dd399d21c9fa016a95ea7782a98a78885617618f3d')
    expect(html).toContain("fetch('/crew/login'")
    expect(html).toContain("new URLSearchParams(location.hash.slice(1)).get('ticket')")
    expect(html).not.toMatch(/<script[^>]+src=|\son[a-z]+=/)
  })

  it('loads nothing: a system font stack, no font file, no image and no link', async () => {
    const { html } = await page()
    expect(html).toContain('-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif')
    for (const load of ['@font-face', '@import', 'url(', '<link', '<img', 'http://', 'https://']) expect(html).not.toContain(load)
  })

  it('shows a plain 12 px "Sign in" line above the title and the message the script fills', async () => {
    const { html } = await page()
    expect(html).toContain('<p class="kicker">Sign in</p>')
    expect(html).toMatch(/\.kicker \{[^}]*font-size: 12px/)
    expect(html).not.toMatch(/text-transform:\s*uppercase/)
    expect(html).toContain('<h1>Crew</h1>')
    expect(html).toContain('<p id="msg">Signing you in…</p>')
  })
})
