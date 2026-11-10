import { Hono } from 'hono'

import { authRoutes } from './auth/routes.js'
import type { TicketStore } from './auth/tickets.js'
import type { BotDeps } from './bots/create.js'
import type { CrewConfig } from './config.js'
import { restProxy } from './hermes/rest-proxy.js'
import type { HermesToken } from './hermes/token.js'
import { botEditRoutes } from './http/bot-edit-routes.js'
import { type ConnectorRouteDeps, connectorRoutes } from './http/connector-routes.js'
import { botRoutes } from './http/bot-routes.js'
import { approvalsRoutes } from './http/approvals-routes.js'
import { sandboxRoutes } from './http/sandbox-routes.js'
import { screenRoutes } from './http/screen-routes.js'
import { routineRoutes } from './http/routine-routes.js'
import { groupRoutes, type GroupRouteDeps } from './http/group-routes.js'
import { hookRoutes } from './http/hook-routes.js'
import { type RelayDeps, relayRoutes } from './http/relay-routes.js'
import { triggerRoutes, type TriggerRouteDeps } from './http/trigger-routes.js'
import { hostGuard } from './http/host-guard.js'
import { originGuard } from './http/origin-guard.js'
import { type CrewEnv, sessionGuard } from './http/session-guard.js'
import { settingsRoutes } from './http/settings-routes.js'
import { stateRoutes } from './http/state-routes.js'
import { spaRoutes } from './http/spa.js'
import type { RoutineService } from './routines/service.js'
import type { SettingsStore } from './settings/settings-store.js'
import type { UsageSource } from './usage/openrouter.js'
import type { CrewStateSource } from './state/crew-state.js'

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
  /** Absent in tests that don't need it; /crew/bots then answers 503 hermes_offline. */
  readonly bots?: BotDeps
  /** Absent in tests that don't need it; /crew/routines then answers 503 hermes_offline. */
  readonly routines?: RoutineService
  readonly watcher?: CrewStateSource
  /** Absent in tests that don't need it; /hooks/:id then answers 503 triggers_unavailable. */
  readonly triggers?: TriggerRouteDeps
  /** Absent in tests that don't need it; /crew/groups then answers 503 hermes_offline. */
  readonly groups?: GroupRouteDeps
  /** Absent in tests that don't need it; /mcp/:bot then answers 503 apps_unavailable. */
  readonly relay?: RelayDeps
  /** Absent in tests that don't need it; /crew/connectors then answers 503 apps_unavailable. */
  readonly connectors?: ConnectorRouteDeps
}

/** Trigger hooks come from outside browsers and prove themselves by signature: no cookie, Origin or CSRF. */
export const HOOK_PATHS = ['POST /hooks/*'] as const

/** The per-bot MCP relay: bots send a bearer token, not a cookie or Origin (the host guard still applies). */
export const RELAY_PATHS = ['POST /mcp/*', 'GET /mcp/*', 'DELETE /mcp/*'] as const

export const PUBLIC_PATHS = [
  'GET /crew/health',
  'GET /login',
  'POST /crew/login',
  'POST /crew/admin/login-ticket',
  ...HOOK_PATHS,
  ...RELAY_PATHS
] as const

/** Build the Crew HTTP app. Guard order: host → origin/CSRF → session → routes. */
export function createApp(deps: AppDeps): Hono<CrewEnv> {
  const app = new Hono<CrewEnv>()
  app.use('*', hostGuard(deps.config.allowedHosts))
  app.use('*', originGuard(deps.config.allowedOrigins, [...HOOK_PATHS, ...RELAY_PATHS]))
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
  app.route('/', botRoutes(deps.bots))
  app.route('/', botEditRoutes(deps.bots))
  app.route('/', screenRoutes(deps.bots))
  app.route('/', approvalsRoutes(deps.bots))
  app.route('/', sandboxRoutes(deps.bots))
  app.route('/', connectorRoutes(deps.connectors))
  app.route('/', hookRoutes(deps.triggers?.hooks))
  app.route('/', relayRoutes(deps.relay))
  app.route('/', routineRoutes(deps.routines, deps.now))
  app.route('/', groupRoutes(deps.groups))
  app.route('/', triggerRoutes(deps.triggers))
  app.route('/', authRoutes(deps))
  app.route('/', restProxy(deps))
  // Last: the SPA answers every remaining GET, so later-mounted routes would be shadowed.
  app.route('/', spaRoutes(deps.config.webDist))
  return app
}
