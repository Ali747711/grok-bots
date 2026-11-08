import { Hono } from 'hono'
import type { Context } from 'hono'
import { IANAZone } from 'luxon'
import { z } from 'zod'

import { PROFILE_NAME_RE } from '../bots/names.js'
import { previewRuns, scheduleSpecSchema } from '../routines/schedule.js'
import type { RoutineService } from '../routines/service.js'
import { failure } from './bot-errors.js'
import type { CrewEnv } from './session-guard.js'

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const DEFAULT_RUN_LIMIT = 20

const timezone = z.string().refine(zone => IANAZone.isValidZone(zone), 'unknown time zone')
const routineBody = z.object({
  title: z.string().min(1).max(80),
  instruction: z.string().min(1).max(4000),
  schedule: scheduleSpecSchema,
  timezone,
  deliverToChat: z.boolean()
})
const previewBody = z.object({ schedule: scheduleSpecSchema, timezone })
const limitSchema = z.coerce.number().int().min(1).max(100)

const badBody = (c: Context, error: z.ZodError) => c.json({ error: 'bad_body', message: error.issues[0]?.message ?? 'invalid body' }, 400)

/** Routes under `/crew/routines`. Every one but `preview` takes `?bot=<name>`. */
export function routineRoutes(service: RoutineService | undefined, now: () => number): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  const requireService = async (c: Context, next: () => Promise<void>): Promise<Response | void> => (service ? next() : c.json({ error: 'hermes_offline' }, 503))
  routes.use('/crew/routines', requireService)
  routes.use('/crew/routines/*', requireService)

  /** Validate `?bot=` (and the `:id`, when the route has one), run `action`, and map any failure. */
  const handle = (hasId: boolean, action: (svc: RoutineService, bot: string, id: string, c: Context) => Promise<Response>) =>
    async (c: Context): Promise<Response> => {
      const bot = c.req.query('bot') ?? ''
      if (!PROFILE_NAME_RE.test(bot)) return c.json({ error: 'bad_bot' }, 400)
      const id = hasId ? c.req.param('id') ?? '' : ''
      if (hasId && !ID_RE.test(id)) return c.json({ error: 'bad_id' }, 400)
      try {
        return await action(service!, bot, id, c)
      } catch (error) {
        const { status, body } = failure(error, bot)
        return c.json(body, status)
      }
    }
  const parse = async (c: Context) => routineBody.safeParse(await c.req.json().catch(() => null))

  routes.get('/crew/routines', handle(false, async (svc, bot, _id, c) => c.json(await svc.list(bot))))

  routes.post('/crew/routines/preview', async c => {
    const parsed = previewBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return badBody(c, parsed.error)
    try {
      return c.json({ next: previewRuns(parsed.data.schedule, parsed.data.timezone, now()) })
    } catch (error) {
      const { status, body } = failure(error, '')
      return c.json(body, status)
    }
  })

  routes.post('/crew/routines', handle(false, async (svc, bot, _id, c) => {
    const parsed = await parse(c)
    return parsed.success ? c.json(await svc.create(bot, parsed.data), 201) : badBody(c, parsed.error)
  }))
  routes.put('/crew/routines/:id', handle(true, async (svc, bot, id, c) => {
    const parsed = await parse(c)
    return parsed.success ? c.json(await svc.update(bot, id, parsed.data)) : badBody(c, parsed.error)
  }))
  routes.post('/crew/routines/:id/pause', handle(true, async (svc, bot, id, c) => c.json(await svc.pause(bot, id))))
  routes.post('/crew/routines/:id/resume', handle(true, async (svc, bot, id, c) => c.json(await svc.resume(bot, id))))
  routes.delete('/crew/routines/:id', handle(true, async (svc, bot, id, c) => {
    await svc.remove(bot, id)
    return c.body(null, 204)
  }))
  routes.post('/crew/routines/:id/run', handle(true, async (svc, bot, id, c) => {
    const status = await svc.runNow(bot, id)
    return status === 'started' ? c.json({ status }, 202) : c.json({ status }, 409)
  }))
  routes.get('/crew/routines/:id/runs', handle(true, async (svc, bot, id, c) => {
    const limit = limitSchema.safeParse(c.req.query('limit') ?? DEFAULT_RUN_LIMIT)
    return limit.success ? c.json(await svc.runs(bot, id, limit.data)) : c.json({ error: 'bad_limit' }, 400)
  }))
  return routes
}
