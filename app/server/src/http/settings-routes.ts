import { Hono } from 'hono'

import { type SettingsStore, settingsPatchSchema } from '../settings/settings-store.js'
import type { CrewEnv } from './session-guard.js'

/** `GET /crew/settings` and `PUT /crew/settings` (guards run before these routes). */
export function settingsRoutes(settings: Pick<SettingsStore, 'get' | 'update'> | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.get('/crew/settings', c => (settings ? c.json(settings.get()) : c.json({ error: 'settings_not_available' }, 503)))
  routes.put('/crew/settings', async c => {
    if (!settings) return c.json({ error: 'settings_not_available' }, 503)
    const body = settingsPatchSchema.safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'bad_body' }, 400)
    return c.json(await settings.update(body.data))
  })
  return routes
}
