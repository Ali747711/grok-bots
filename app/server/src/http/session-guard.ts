import type { IncomingMessage } from 'node:http'

import type { MiddlewareHandler } from 'hono'

import { SESSION_COOKIE } from '../auth/routes.js'
import { verifySession } from '../auth/session-cookie.js'
import type { CrewConfig } from '../config.js'
import { parseCookieHeader } from './cookies.js'

export interface CrewEnv {
  Variables: { sid: string }
}

/** Require a valid Crew session cookie, except for `"METHOD /path"` entries in `publicPaths`. */
export function sessionGuard(
  key: Buffer,
  now: () => number,
  publicPaths: readonly string[]
): MiddlewareHandler<CrewEnv> {
  const open = new Set(publicPaths)
  return async (c, next) => {
    if (open.has(`${c.req.method} ${c.req.path}`)) return next()
    const cookies = parseCookieHeader(c.req.header('cookie'))
    const session = verifySession(key, cookies[SESSION_COOKIE], now())
    if (!session) return c.json({ error: 'login_required' }, 401)
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
