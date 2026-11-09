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
const FINISHED_MESSAGE = 'This one-time routine has already run.'

const timezone = z.string().refine(zone => IANAZone.isValidZone(zone), 'unknown time zone')
const routineBody = z.object({
  title: z.string().min(1).max(80),
  instruction: z.string().min(1).max(4000),
  schedule: scheduleSpecSchema,
  timezone,
  deliverToChat: z.boolean(),
  timezoneChanged: z.boolean().optional()
})
const previewBody = z.object({ schedule: scheduleSpecSchema, timezone })
const limitSchema = z.coerce.number().int().min(1).max(100)

const badBody = (c: Context, error: z.ZodError) => c.json({ error: 'bad_body', message: error.issues[0]?.message ?? 'invalid body' }, 400)

type Action = (svc: RoutineService, bot: string, id: string, c: Context) => Promise<Response>

/** Validate `?bot=` (and `:id` when the route has one), run `action`, and map any failure. */
function handle(service: RoutineService | undefined, hasId: boolean, action: Action) {
  return async (c: Context): Promise<Response> => {
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
}

const parseRoutine = async (c: Context) => routineBody.safeParse(await c.req.json().catch(() => null))

const create: Action = async (svc, bot, _id, c) => {
  const parsed = await parseRoutine(c)
  return parsed.success ? c.json(await svc.create(bot, parsed.data), 201) : badBody(c, parsed.error)
}

const update: Action = async (svc, bot, id, c) => {
  const parsed = await parseRoutine(c)
  return parsed.success ? c.json(await svc.update(bot, id, parsed.data)) : badBody(c, parsed.error)
}

const run: Action = async (svc, bot, id, c) => {
  const status = await svc.runNow(bot, id)
  if (status === 'started') return c.json({ status }, 202)
  return status === 'finished' ? c.json({ status, message: FINISHED_MESSAGE }, 409) : c.json({ status }, 409)
}

const runs: Action = async (svc, bot, id, c) => {
  const limit = limitSchema.safeParse(c.req.query('limit') ?? DEFAULT_RUN_LIMIT)
  return limit.success ? c.json(await svc.runs(bot, id, limit.data)) : c.json({ error: 'bad_limit' }, 400)
}

const remove: Action = async (svc, bot, id, c) => {
  await svc.remove(bot, id)
  return c.body(null, 204)
}

async function preview(c: Context, now: () => number): Promise<Response> {
  const parsed = previewBody.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return badBody(c, parsed.error)
  try {
    return c.json({ next: previewRuns(parsed.data.schedule, parsed.data.timezone, now()) })
  } catch (error) {
    const { status, body } = failure(error, '')
    return c.json(body, status)
  }
}

/** Routes under `/crew/routines`. Every one but `preview` takes `?bot=<name>`. */
export function routineRoutes(service: RoutineService | undefined, now: () => number): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  const requireService = async (c: Context, next: () => Promise<void>): Promise<Response | void> => (service ? next() : c.json({ error: 'hermes_offline' }, 503))
  routes.use('/crew/routines', requireService)
  routes.use('/crew/routines/*', requireService)
  const on = (hasId: boolean, action: Action) => handle(service, hasId, action)

  routes.get('/crew/routines', on(false, async (svc, bot, _id, c) => c.json(await svc.list(bot))))
  routes.post('/crew/routines/preview', c => preview(c, now))
  routes.post('/crew/routines', on(false, create))
  routes.put('/crew/routines/:id', on(true, update))
  routes.post('/crew/routines/:id/pause', on(true, async (svc, bot, id, c) => c.json(await svc.pause(bot, id))))
  routes.post('/crew/routines/:id/resume', on(true, async (svc, bot, id, c) => c.json(await svc.resume(bot, id))))
  routes.delete('/crew/routines/:id', on(true, remove))
  routes.post('/crew/routines/:id/run', on(true, run))
  routes.get('/crew/routines/:id/runs', on(true, runs))
  return routes
}
