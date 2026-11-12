import { Hono } from 'hono'
import { z } from 'zod'

import type { BotDeps } from '../bots/create.js'
import { PROFILE_NAME_RE } from '../bots/names.js'
import { readToolsets, setToolset } from '../bots/toolsets.js'
import { failure } from './bot-errors.js'
import { requireBot } from './sandbox-routes.js'
import type { CrewEnv } from './session-guard.js'

const PRIMARY = 'default'
const putBody = z.object({ name: z.string().regex(/^[a-z0-9_-]{1,64}$/), enabled: z.boolean() }).strict()

/** `GET|PUT /crew/bots/:name/toolsets`. GET is open to every bot; PUT refuses the primary. */
export function toolsetRoutes(bots: BotDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.use('/crew/bots/:name/toolsets', async (c, next) => {
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

  routes.get('/crew/bots/:name/toolsets', c => guarded(c.req.param('name'), async deps => c.json(await readToolsets(deps, c.req.param('name')))))

  routes.put('/crew/bots/:name/toolsets', async c => {
    const name = c.req.param('name')
    // Refused before any read: new bots clone the primary's config.
    if (name === PRIMARY) return c.json({ error: 'primary_not_supported' }, 400)
    const parsed = putBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'bad_body', message: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
    return guarded(name, async deps => c.json(await setToolset(deps, name, parsed.data.name, parsed.data.enabled)))
  })
  return routes
}
