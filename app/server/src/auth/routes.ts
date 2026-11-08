import { randomBytes, timingSafeEqual } from 'node:crypto'

import { Hono } from 'hono'
import { setCookie } from 'hono/cookie'
import { z } from 'zod'

import type { CrewConfig } from '../config.js'
import { LOGIN_PAGE_HTML } from './login-page.js'
import { signSession } from './session-cookie.js'
import type { TicketStore } from './tickets.js'

export const SESSION_COOKIE = 'crew_session'
export const CSRF_COOKIE = 'crew_csrf'
export const SESSION_MAX_AGE_S = 7_776_000 // 90 days

export interface AuthDeps {
  readonly config: CrewConfig
  readonly secrets: { readonly admin: Buffer; readonly cookie: Buffer }
  readonly tickets: TicketStore
  readonly now: () => number
}

const loginBody = z.object({ ticket: z.string().min(1).max(128) })

function sameSecret(given: string | undefined, secret: Buffer): boolean {
  if (!given) return false
  const a = Buffer.from(given)
  const b = Buffer.from(secret.toString('hex'))
  return a.length === b.length && timingSafeEqual(a, b)
}

const LOGIN_PAGE_HEADERS = {
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'"
}

/** Public routes: login page, ticket redemption, and the admin endpoint used by the `crew login` CLI. */
export function authRoutes(deps: AuthDeps): Hono {
  const routes = new Hono()

  routes.get('/login', c => c.html(LOGIN_PAGE_HTML, 200, LOGIN_PAGE_HEADERS))

  routes.post('/crew/admin/login-ticket', c => {
    if (!sameSecret(c.req.header('x-crew-admin'), deps.secrets.admin)) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    const ticket = deps.tickets.mint(deps.now())
    return c.json({ url: `http://${deps.config.allowedHosts[0]}/login#ticket=${ticket}` })
  })

  routes.post('/crew/login', async c => {
    const origin = c.req.header('origin')
    if (!origin || !deps.config.allowedOrigins.includes(origin)) {
      return c.json({ error: 'bad_origin' }, 403)
    }
    const body = loginBody.safeParse(await c.req.json().catch(() => null))
    if (!body.success || !deps.tickets.redeem(body.data.ticket, deps.now())) {
      return c.json({ error: 'invalid_ticket' }, 401)
    }
    const session = { sid: randomBytes(16).toString('base64url'), exp: deps.now() + SESSION_MAX_AGE_S * 1000 }
    const base = { path: '/', sameSite: 'Strict', maxAge: SESSION_MAX_AGE_S } as const
    setCookie(c, SESSION_COOKIE, signSession(deps.secrets.cookie, session), { ...base, httpOnly: true })
    setCookie(c, CSRF_COOKIE, randomBytes(32).toString('base64url'), base)
    return c.body(null, 204)
  })

  return routes
}
