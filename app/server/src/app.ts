import { Hono } from 'hono'

import { authRoutes } from './auth/routes.js'
import type { TicketStore } from './auth/tickets.js'
import type { CrewConfig } from './config.js'
import { restProxy } from './hermes/rest-proxy.js'
import type { HermesToken } from './hermes/token.js'
import { hostGuard } from './http/host-guard.js'
import { originGuard } from './http/origin-guard.js'
import { type CrewEnv, sessionGuard } from './http/session-guard.js'
import { settingsRoutes } from './http/settings-routes.js'
import { stateRoutes } from './http/state-routes.js'
import { spaRoutes } from './http/spa.js'
import type { SettingsStore } from './settings/settings-store.js'
import type { UsageSource } from './usage/openrouter.js'
import type { Watcher } from './watcher/watcher.js'

export interface AppDeps {
  readonly config: CrewConfig
  readonly secrets: { readonly admin: Buffer; readonly cookie: Buffer }
  readonly tickets: TicketStore
  readonly now: () => number
  readonly token: HermesToken
  readonly fetchUpstream: typeof fetch
  /** Absent in tests that don't need it; /crew/pending then answers 503. */
  /** Absent in tests that don't need it; /crew/usage then answers 503. */
  readonly usage?: UsageSource
  /** Absent in tests that don't need it; /crew/settings then answers 503. */
  readonly settings?: Pick<SettingsStore, 'get' | 'update'>
  readonly watcher?: Pick<Watcher, 'store' | 'debug' | 'state' | 'onChange' | 'answer' | 'getAvatar'>
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
  app.get('/crew/usage', async c => (deps.usage ? c.json(await deps.usage.get()) : c.json({ error: 'usage_not_configured' }, 503)))
  app.route('/', stateRoutes(deps.watcher))
  app.route('/', settingsRoutes(deps.settings))
  app.route('/', authRoutes(deps))
  app.route('/', restProxy(deps))
  // Last: the SPA answers every remaining GET, so later-mounted routes would be shadowed.
  app.route('/', spaRoutes(deps.config.webDist))
  return app
}
