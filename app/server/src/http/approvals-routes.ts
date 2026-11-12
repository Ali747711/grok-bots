import { Hono } from 'hono'
import { z } from 'zod'

import { APPROVAL_MODES, readApprovals, setApprovals } from '../bots/approvals.js'
import type { BotDeps } from '../bots/create.js'
import { PROFILE_NAME_RE } from '../bots/names.js'
import { failure } from './bot-errors.js'
import { requireBot } from './sandbox-routes.js'
import type { CrewEnv } from './session-guard.js'

const PRIMARY = 'default'
const putBody = z.object({ mode: z.enum(APPROVAL_MODES) }).strict()

/** `GET|PUT /crew/bots/:name/approvals`. GET is open to every bot; PUT refuses the primary. */
export function approvalsRoutes(bots: BotDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.use('/crew/bots/:name/approvals', async (c, next) => {
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

  routes.get('/crew/bots/:name/approvals', c => guarded(c.req.param('name'), async deps => c.json(await readApprovals(deps, c.req.param('name')))))

  routes.put('/crew/bots/:name/approvals', async c => {
    const name = c.req.param('name')
    // Refused before any read, like the screen routes: new bots clone the primary's config.
    if (name === PRIMARY) return c.json({ error: 'primary_not_supported' }, 400)
    const parsed = putBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'bad_body', message: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
    return guarded(name, async deps => c.json(await setApprovals(deps, name, parsed.data.mode)))
  })
  return routes
}
