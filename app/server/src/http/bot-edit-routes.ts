import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'

import type { BotDeps } from '../bots/create.js'
import { clearAvatar, deleteBot, readBotDetail, setAvatar, updateBot } from '../bots/edit.js'
import { PROFILE_NAME_RE } from '../bots/names.js'
import { failure } from './bot-errors.js'
import type { CrewEnv } from './session-guard.js'

const BODY_MAX_BYTES = 3 * 1024 * 1024
const IMAGE_MAX_CHARS = 2_700_000

const model = z.object({ provider: z.string().min(1), model: z.string().min(1) })
const image = z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(IMAGE_MAX_CHARS)
const GUARDED = ['soul', 'description', 'model'] as const
const patchBody = z.object({
  title: z.string().min(1).max(80),
  look: z.object({ shape: z.enum(['circle', 'squircle']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
  hidden: z.boolean(),
  description: z.string().max(2000),
  soul: z.string().max(100_000),
  model,
  confirmExpensiveModel: z.boolean(),
  baseline: z.object({ description: z.string(), soul: z.string(), model: model.nullable() }).partial()
}).partial().superRefine((patch, ctx) => {
  const changes = Object.keys(patch).some(key => key !== 'baseline' && key !== 'confirmExpensiveModel' && patch[key as keyof typeof patch] !== undefined)
  if (!changes) ctx.addIssue({ code: 'custom', message: 'empty patch' })
  // SOUL, description and model have no revision in Hermes: refuse to write them without the loaded value.
  for (const field of GUARDED) {
    if (patch[field] !== undefined && !(patch.baseline && field in patch.baseline)) ctx.addIssue({ code: 'custom', message: `baseline.${field} is required to change ${field}` })
  }
})

/** `GET|PATCH|DELETE /crew/bots/:name`, `PUT|DELETE /crew/bots/:name/avatar`. Reserved names are fine here; only delete refuses `default`. */
export function botEditRoutes(bots: BotDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  const limit = bodyLimit({ maxSize: BODY_MAX_BYTES, onError: c => c.json({ error: 'too_large' }, 413) })
  routes.use('/crew/bots/:name', async (c, next) => {
    if (!bots) return c.json({ error: 'hermes_offline' }, 503)
    return PROFILE_NAME_RE.test(c.req.param('name') ?? '') ? next() : c.json({ error: 'not_found' }, 404)
  })
  routes.use('/crew/bots/:name/avatar', async (c, next) => {
    if (!bots) return c.json({ error: 'hermes_offline' }, 503)
    return PROFILE_NAME_RE.test(c.req.param('name') ?? '') ? next() : c.json({ error: 'not_found' }, 404)
  })
  /** Run `action`, turning every failure into its HTTP answer. */
  const guarded = async (name: string, action: (deps: BotDeps) => Promise<Response>): Promise<Response> => {
    try {
      return await action(bots!)
    } catch (error) {
      const { status, body } = failure(error, name)
      return Response.json(body, { status })
    }
  }

  routes.get('/crew/bots/:name', c => guarded(c.req.param('name'), async deps => c.json(await readBotDetail(deps, c.req.param('name')))))

  routes.patch('/crew/bots/:name', limit, async c => {
    const parsed = patchBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'bad_body', message: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
    return guarded(c.req.param('name'), async deps => {
      const outcome = await updateBot(deps, c.req.param('name'), parsed.data)
      return outcome.status === 'saved' ? c.json(outcome, 200) : c.json(outcome, 409)
    })
  })

  routes.put('/crew/bots/:name/avatar', limit, async c => {
    const parsed = z.object({ image }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'bad_body', message: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
    return guarded(c.req.param('name'), async deps => c.json(await setAvatar(deps, c.req.param('name'), parsed.data.image)))
  })

  routes.delete('/crew/bots/:name/avatar', c => guarded(c.req.param('name'), async deps => c.json(await clearAvatar(deps, c.req.param('name')))))

  routes.delete('/crew/bots/:name', c => guarded(c.req.param('name'), async deps => {
    await deleteBot(deps, c.req.param('name'))
    return c.body(null, 204)
  }))
  return routes
}
