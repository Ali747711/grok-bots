import { Hono } from 'hono'

import type { CrewConfig } from './config.js'
import { hostGuard } from './http/host-guard.js'

export interface AppDeps {
  readonly config: CrewConfig
}

/** Build the Crew HTTP app. Middleware order matters: host guard runs before everything else. */
export function createApp(deps: AppDeps): Hono {
  const app = new Hono()
  app.use('*', hostGuard(deps.config.allowedHosts))
  app.get('/crew/health', c => c.json({ ok: true }))
  return app
}
