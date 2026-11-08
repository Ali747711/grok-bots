import { timingSafeEqual } from 'node:crypto'

import type { MiddlewareHandler } from 'hono'

import { CSRF_COOKIE } from '../auth/routes.js'
import { parseCookieHeader } from './cookies.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])
/** Authenticated by the X-Crew-Admin secret; called by the CLI, which sends no Origin. */
const ORIGIN_EXEMPT = new Set(['POST /crew/admin/login-ticket'])
/** No CSRF cookie exists yet at login; the Origin check still applies. */
const CSRF_EXEMPT = new Set(['POST /crew/login', 'POST /crew/admin/login-ticket'])

function sameValue(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * For state-changing requests: require one of Crew's exact Origins (missing and `null` are refused),
 * then a double-submit CSRF token (`X-Crew-CSRF` header equal to the `crew_csrf` cookie).
 */
export function originGuard(allowedOrigins: readonly string[]): MiddlewareHandler {
  const allowed = new Set(allowedOrigins)
  return async (c, next) => {
    const route = `${c.req.method} ${c.req.path}`
    if (SAFE_METHODS.has(c.req.method) || ORIGIN_EXEMPT.has(route)) return next()

    const origin = c.req.header('origin')
    if (!origin || !allowed.has(origin)) return c.json({ error: 'bad_origin' }, 403)
    if (CSRF_EXEMPT.has(route)) return next()

    const cookie = parseCookieHeader(c.req.header('cookie'))[CSRF_COOKIE]
    const sent = c.req.header('x-crew-csrf')
    if (!cookie || !sent || !sameValue(cookie, sent)) return c.json({ error: 'bad_csrf' }, 403)
    await next()
  }
}
