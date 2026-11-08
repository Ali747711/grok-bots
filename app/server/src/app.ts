import { Hono } from 'hono'

import { authRoutes } from './auth/routes.js'
import type { TicketStore } from './auth/tickets.js'
import type { CrewConfig } from './config.js'
import { hostGuard } from './http/host-guard.js'
import { originGuard } from './http/origin-guard.js'
import { type CrewEnv, sessionGuard } from './http/session-guard.js'

export interface AppDeps {
  readonly config: CrewConfig
  readonly secrets: { readonly admin: Buffer; readonly cookie: Buffer }
  readonly tickets: TicketStore
  readonly now: () => number
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
  app.route('/', authRoutes(deps))
  return app
}
