import { Hono } from 'hono'

import { authRoutes } from './auth/routes.js'
import type { TicketStore } from './auth/tickets.js'
import type { CrewConfig } from './config.js'
import { restProxy } from './hermes/rest-proxy.js'
import type { HermesToken } from './hermes/token.js'
import { hostGuard } from './http/host-guard.js'
import { originGuard } from './http/origin-guard.js'
import { type CrewEnv, sessionGuard } from './http/session-guard.js'
import type { Watcher } from './watcher/watcher.js'

export interface AppDeps {
  readonly config: CrewConfig
  readonly secrets: { readonly admin: Buffer; readonly cookie: Buffer }
  readonly tickets: TicketStore
  readonly now: () => number
  readonly token: HermesToken
  readonly fetchUpstream: typeof fetch
  /** Absent in tests that don't need it; /crew/pending then answers 503. */
  readonly watcher?: Pick<Watcher, 'store' | 'debug'>
}

export const PUBLIC_PATHS = [
  'GET /crew/health',
  'GET /login',
  'POST /crew/login',
  'POST /crew/admin/login-ticket'
] as const

/** Build the Crew HTTP app. Guard order: host → origin/CSRF → session → routes. */
export function createApp(deps: AppDeps): Hono<CrewEnv> {
  const app = new Hono<CrewEnv>()
  app.use('*', hostGuard(deps.config.allowedHosts))
  app.use('*', originGuard(deps.config.allowedOrigins))
  app.use('*', sessionGuard(deps.secrets.cookie, deps.now, PUBLIC_PATHS))
  app.get('/crew/health', c => c.json({ ok: true }))
  app.on(['GET', 'POST'], '/crew/whoami', c => c.json({ sid: c.get('sid') }))
  app.get('/crew/pending', c => {
    if (!deps.watcher) return c.json({ error: 'watcher_not_running' }, 503)
    return c.json({ pending: deps.watcher.store.list(), debug: deps.watcher.debug() })
  })
  app.route('/', authRoutes(deps))
  app.route('/', restProxy(deps))
  return app
}
