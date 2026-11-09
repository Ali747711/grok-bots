import type { IncomingMessage } from 'node:http'

import type { Context, MiddlewareHandler } from 'hono'

import { SESSION_COOKIE } from '../auth/routes.js'
import { verifySession } from '../auth/session-cookie.js'
import type { CrewConfig } from '../config.js'
import { parseCookieHeader } from './cookies.js'

export interface CrewEnv {
  Variables: { sid: string }
}

/** A page load (not an API call): GET outside /api and /crew that accepts HTML. */
function isBrowserNavigation(c: Context): boolean {
  if (c.req.method !== 'GET' || /^\/(api|crew)(\/|$)/.test(c.req.path)) return false
  return (c.req.header('accept') ?? '').includes('text/html')
}

/**
 * Does `METHOD path` match one of the `"METHOD /path"` entries? An exact entry matches as is. An entry
 * ending in `/*` matches exactly one more non-empty segment (`POST /hooks/*` matches `POST /hooks/x`, not
 * `/hooks/`, `/hooks/x/y` or `GET /hooks/x`).
 */
export function routeMatches(entries: readonly string[], method: string, path: string): boolean {
  const route = `${method} ${path}`
  return entries.some(entry => {
    if (!entry.endsWith('/*')) return entry === route
    const prefix = entry.slice(0, -1)
    const rest = route.startsWith(prefix) ? route.slice(prefix.length) : ''
    return rest !== '' && !rest.includes('/')
  })
}

/** Require a valid Crew session cookie, except for `"METHOD /path"` entries in `publicPaths`. */
export function sessionGuard(
  key: Buffer,
  now: () => number,
  publicPaths: readonly string[]
): MiddlewareHandler<CrewEnv> {
  return async (c, next) => {
    if (routeMatches(publicPaths, c.req.method, c.req.path)) return next()
    const cookies = parseCookieHeader(c.req.header('cookie'))
    const session = verifySession(key, cookies[SESSION_COOKIE], now())
    if (!session) return isBrowserNavigation(c) ? c.redirect('/login', 302) : c.json({ error: 'login_required' }, 401)
    c.set('sid', session.sid)
    await next()
  }
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/**
 * WebSocket upgrades bypass the Hono middleware, and browsers apply no CORS to WebSockets,
 * so the upgrade itself must prove: our Host, our exact Origin, and a valid session cookie.
 */
export function isAllowedUpgrade(req: IncomingMessage, cfg: CrewConfig, key: Buffer, nowMs: number): boolean {
  const host = header(req, 'host')
  const origin = header(req, 'origin')
  if (!host || !cfg.allowedHosts.includes(host)) return false
  if (!origin || !cfg.allowedOrigins.includes(origin)) return false
  const cookies = parseCookieHeader(header(req, 'cookie'))
  return verifySession(key, cookies[SESSION_COOKIE], nowMs) !== null
}
