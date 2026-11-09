import { Hono } from 'hono'
import type { Context } from 'hono'
import { z } from 'zod'

import { PROFILE_NAME_RE } from '../bots/names.js'
import type { RoutineService } from '../routines/service.js'
import type { HookHandler } from '../triggers/hook-handler.js'
import { sampleEvent } from '../triggers/sample-event.js'
import type { TriggerStore } from '../triggers/store.js'
import { EVENT_NAME_RE, ROUTINE_ID_RE, toView, TRIGGER_ID_RE, TRIGGER_SOURCES, type Trigger } from '../triggers/types.js'
import { log } from '../log.js'
import type { CrewEnv } from './session-guard.js'

export interface TriggerRouteDeps {
  readonly store: TriggerStore
  readonly hooks: HookHandler
  readonly routines: Pick<RoutineService, 'list'>
  readonly hookUrl: (triggerId: string) => string
  readonly now: () => number
  readonly newTriggerId: () => string
  readonly newSecret: () => string
  readonly newId: () => string
}

const eventName = z.string().regex(EVENT_NAME_RE)
const names = z.array(eventName).max(20)
const name = z.string().trim().min(1).max(80)
const createBody = z.object({ routineId: z.string().regex(ROUTINE_ID_RE), name, source: z.enum(TRIGGER_SOURCES), events: names.optional(), actions: names.optional() }).strict()
const patchBody = z.object({ name: name.optional(), enabled: z.boolean().optional(), events: names.optional(), actions: names.optional() }).strict()
  .refine(b => Object.keys(b).length > 0, 'nothing to change')

const unique = (list: readonly string[] | undefined): string[] => [...new Set(list ?? [])]

/**
 * `/crew/bots/:bot/triggers` and `/crew/triggers/:id…`. The secret is in the create and new-secret
 * replies only: no list, event, log line or error ever carries it.
 */
export function triggerRoutes(deps: TriggerRouteDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.use('/crew/bots/:bot/triggers', async (c, next) => (deps ? next() : c.json({ error: 'hermes_offline' }, 503)))
  routes.use('/crew/triggers/*', async (c, next) => (deps ? next() : c.json({ error: 'hermes_offline' }, 503)))

  const badBody = (c: Context, message: string) => c.json({ error: 'bad_body', message }, 400)
  const body = async <T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T> | Response> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null))
    return parsed.success ? parsed.data : badBody(c, parsed.error.issues[0]?.message ?? 'invalid body')
  }
  /** The trigger named by `:id`, or the error response. */
  const found = (c: Context): Trigger | Response => {
    const id = c.req.param('id') ?? ''
    if (!TRIGGER_ID_RE.test(id)) return c.json({ error: 'bad_id' }, 400)
    return deps!.store.get(id) ?? c.json({ error: 'not_found' }, 404)
  }
  const notSaved = (c: Context, error: unknown): Response => {
    log.warn('trigger store write failed', { error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' })
    return c.json({ error: 'not_saved' }, 500)
  }
  const view = (t: Trigger) => toView(t, deps!.hookUrl(t.id), deps!.store.lastEvent(t.id))

  routes.get('/crew/bots/:bot/triggers', c => {
    const bot = c.req.param('bot')
    if (!PROFILE_NAME_RE.test(bot)) return c.json({ error: 'bad_bot' }, 400)
    return c.json({ triggers: deps!.store.forBot(bot).map(view) })
  })

  routes.post('/crew/bots/:bot/triggers', async c => {
    const bot = c.req.param('bot')
    if (!PROFILE_NAME_RE.test(bot)) return c.json({ error: 'bad_bot' }, 400)
    const parsed = await body(c, createBody)
    if (parsed instanceof Response) return parsed
    if (parsed.source === 'generic' && (parsed.actions?.length ?? 0) > 0) return badBody(c, 'actions are for GitHub triggers only')
    try {
      const routines = await deps!.routines.list(bot)
      if (!routines.some(r => r.id === parsed.routineId)) return c.json({ error: 'routine_not_found' }, 404)
    } catch {
      return c.json({ error: 'hermes_offline' }, 503)
    }
    const trigger: Trigger = {
      id: deps!.newTriggerId(), bot, routineId: parsed.routineId, name: parsed.name, source: parsed.source,
      events: unique(parsed.events), actions: unique(parsed.actions), enabled: true, secret: deps!.newSecret(), createdAt: deps!.now()
    }
    try {
      await deps!.store.add(trigger)
    } catch (error) {
      return notSaved(c, error)
    }
    return c.json({ trigger: view(trigger), secret: trigger.secret, url: deps!.hookUrl(trigger.id) }, 201)
  })

  routes.patch('/crew/triggers/:id', async c => {
    const t = found(c)
    if (t instanceof Response) return t
    const parsed = await body(c, patchBody)
    if (parsed instanceof Response) return parsed
    if (t.source === 'generic' && (parsed.actions?.length ?? 0) > 0) return badBody(c, 'actions are for GitHub triggers only')
    try {
      const next = await deps!.store.update(t.id, {
        ...(parsed.name === undefined ? {} : { name: parsed.name }),
        ...(parsed.enabled === undefined ? {} : { enabled: parsed.enabled }),
        ...(parsed.events === undefined ? {} : { events: unique(parsed.events) }),
        ...(parsed.actions === undefined ? {} : { actions: unique(parsed.actions) })
      })
      return next ? c.json(view(next)) : c.json({ error: 'not_found' }, 404)
    } catch (error) {
      return notSaved(c, error)
    }
  })

  routes.post('/crew/triggers/:id/secret', async c => {
    const t = found(c)
    if (t instanceof Response) return t
    const secret = deps!.newSecret()
    try {
      await deps!.store.update(t.id, { secret })
    } catch (error) {
      return notSaved(c, error)
    }
    return c.json({ secret })
  })

  routes.delete('/crew/triggers/:id', async c => {
    const t = found(c)
    if (t instanceof Response) return t
    try {
      await deps!.store.remove(t.id)
    } catch (error) {
      return notSaved(c, error)
    }
    return c.body(null, 204)
  })

  routes.get('/crew/triggers/:id/events', c => {
    const t = found(c)
    return t instanceof Response ? t : c.json({ events: deps!.store.events(t.id) })
  })

  routes.post('/crew/triggers/:id/test', async c => {
    const t = found(c)
    if (t instanceof Response) return t
    // Signed with the trigger's own secret and handled in-process: the same checks as a real event, no network.
    const sample = sampleEvent(t, deps!.now(), deps!.newId())
    const result = await deps!.hooks.handle(t.id, sample.raw, sample.headers)
    return c.json({ httpStatus: result.status, event: result.event })
  })

  return routes
}
