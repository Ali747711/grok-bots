import { Hono } from 'hono'
import { z } from 'zod'

import { withBotLock } from '../bots/bot-lock.js'
import type { BotDeps } from '../bots/create.js'
import { PROFILE_NAME_RE } from '../bots/names.js'
import { ensureIdleStop, readScreenConfig, setIdleStop, setUseScreen } from '../bots/screen-config.js'
import { BotNotFoundError } from '../bots/ui-meta.js'
import { HermesRestError, HermesUnavailableError } from '../hermes/errors.js'
import { log } from '../log.js'
import { failure } from './bot-errors.js'
import type { CrewEnv } from './session-guard.js'

const PRIMARY = 'default'
const START_TIMEOUT_MS = 30_000
const putBody = z.object({ useScreen: z.boolean(), idleStopMinutes: z.union([z.literal(15), z.literal(60), z.literal(0)]) })
  .partial()
  .strict()
  .refine(body => body.useScreen !== undefined || body.idleStopMinutes !== undefined, { message: 'nothing to change' })

/** Roster check with Hermes's own profile-name rule, so `default` is allowed (§11 R8). */
async function requireBot(deps: BotDeps, name: string): Promise<void> {
  const list = await deps.rpc<{ profiles: readonly { name: string }[] }>('profiles.list', { include_sessions: false })
  if (!list.profiles.some(p => p.name === name)) throw new BotNotFoundError(name)
}

async function screenView(deps: BotDeps, name: string): Promise<{ useScreen: boolean; idleStopMinutes: number | null }> {
  const cfg = await readScreenConfig(deps, name)
  return { useScreen: cfg.headed && cfg.autoStart, idleStopMinutes: cfg.idleStopMinutes }
}

/** `POST …/screen/start`, `GET|PUT …/screen/config`. */
export function screenRoutes(bots: BotDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.use('/crew/bots/:name/screen/*', async (c, next) => {
    if (!bots) return c.json({ error: 'hermes_offline' }, 503)
    return PROFILE_NAME_RE.test(c.req.param('name') ?? '') ? next() : c.json({ error: 'not_found' }, 404)
  })
  const guarded = async (name: string, action: (deps: BotDeps) => Promise<Response>): Promise<Response> => {
    try {
      await requireBot(bots!, name)
      return await action(bots!)
    } catch (error) {
      const { status, body } = failure(error, name)
      return Response.json(body, { status })
    }
  }

  routes.post('/crew/bots/:name/screen/start', c => guarded(c.req.param('name'), async deps => {
    const name = c.req.param('name')
    try {
      await withBotLock(name, () => ensureIdleStop(deps, name))
    } catch (error) {
      if (error instanceof HermesUnavailableError || (error instanceof HermesRestError && error.status === 404)) throw error
      // Only Hermes's own detail is safe to show; any other error text could carry config text.
      const message = error instanceof HermesRestError ? error.detail : 'screen config could not be saved'
      log.warn('screen idle stop write failed', { name, error: message.slice(0, 200) })
      return c.json({ error: 'screen_config_failed', message }, 502)
    }
    // Outside the lock: display.start blocks for seconds and must not hold up other edits.
    return c.json(await deps.rpc('display.start', { profile: name }, START_TIMEOUT_MS))
  }))

  routes.get('/crew/bots/:name/screen/config', c => guarded(c.req.param('name'), async deps => c.json(await screenView(deps, c.req.param('name')))))

  routes.put('/crew/bots/:name/screen/config', async c => {
    const parsed = putBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'bad_body', message: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
    const name = c.req.param('name')
    // New bots clone the primary's config.yaml, so a headed primary would make every later bot headed (§11 R8).
    if (name === PRIMARY) return c.json({ error: 'primary_not_supported' }, 400)
    return guarded(name, async deps => {
      const { useScreen, idleStopMinutes } = parsed.data
      await withBotLock(name, async () => {
        if (idleStopMinutes !== undefined) await setIdleStop(deps, name, idleStopMinutes)
        if (useScreen !== undefined) await setUseScreen(deps, name, useScreen)
      })
      deps.voice?.changed(name)
      return c.json(await screenView(deps, name))
    })
  })
  return routes
}
