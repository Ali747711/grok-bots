import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'

import { type CrewAvatar, crewAvatarSchema, deriveAvatarType } from '../bots/avatar.js'
import { type BotDeps, createBot, finishBot } from '../bots/create.js'
import { PROFILE_NAME_RE, validateBotName } from '../bots/names.js'
import { failure } from './bot-errors.js'
import type { CrewEnv } from './session-guard.js'

const BODY_MAX_BYTES = 3 * 1024 * 1024
const IMAGE_MAX_CHARS = 2_700_000

// transitional: remove in UI rebuild Task 7 once the web sends avatar
const legacyLook = z.object({ shape: z.enum(['circle', 'squircle']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) })
const image = z.string().regex(/^data:image\/(png|jpeg|webp);base64,/).max(IMAGE_MAX_CHARS)
const createBody = z.object({
  name: z.string(),
  title: z.string().max(80).default(''),
  mission: z.string().max(2000).default(''),
  avatar: crewAvatarSchema.optional(),
  look: legacyLook.optional(),
  image: image.optional(),
  model: z.object({ provider: z.string().min(1), model: z.string().min(1) }).optional()
})
const finishBody = z.object({ avatar: crewAvatarSchema.optional(), look: legacyLook.optional(), title: z.string().max(80).optional(), image: image.optional() })

/** The avatar to store: `avatar` wins; else a legacy look's colour on the handle's derived type. */
function resolveAvatar(name: string, avatar: CrewAvatar | undefined, look: { color: string } | undefined): CrewAvatar | undefined {
  return avatar ?? (look ? { type: deriveAvatarType(name), color: look.color } : undefined)
}

/** `POST /crew/bots` (create) and `POST /crew/bots/:name/finish` (complete a half-made bot). */
export function botRoutes(bots: BotDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  /** One create/finish per name at a time. */
  const inFlight = new Set<string>()
  const limit = bodyLimit({ maxSize: BODY_MAX_BYTES, onError: c => c.json({ error: 'too_large' }, 413) })

  routes.post('/crew/bots', limit, async c => {
    if (!bots) return c.json({ error: 'hermes_offline' }, 503)
    const parsed = createBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'bad_body', message: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
    const { look: legacy, avatar: sent, ...rest } = parsed.data
    const avatar = resolveAvatar(rest.name, sent, legacy)
    if (!avatar) return c.json({ error: 'bad_body', message: 'avatar is required' }, 400)
    const draft = { ...rest, avatar }
    const check = validateBotName(draft.name)
    if (!check.ok) return c.json({ error: 'bad_name', message: check.reason }, 400)
    if (inFlight.has(draft.name)) return c.json({ error: 'in_progress' }, 409)
    inFlight.add(draft.name)
    try {
      return c.json(await createBot(bots, draft), 201)
    } catch (error) {
      const { status, body } = failure(error, draft.name)
      return c.json(body, status)
    } finally {
      inFlight.delete(draft.name)
    }
  })

  routes.post('/crew/bots/:name/finish', limit, async c => {
    if (!bots) return c.json({ error: 'hermes_offline' }, 503)
    const name = c.req.param('name')
    if (!PROFILE_NAME_RE.test(name)) return c.json({ error: 'not_found' }, 404)
    // Finishing would write a look and title over the primary bot ("Hermes" would become "Default").
    if (name === 'default') return c.json({ error: 'cannot_finish_primary' }, 400)
    const parsed = finishBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'bad_body', message: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
    if (inFlight.has(name)) return c.json({ error: 'in_progress' }, 409)
    inFlight.add(name)
    try {
      const { look: legacy, avatar: sent, ...rest } = parsed.data
      const avatar = resolveAvatar(name, sent, legacy)
      return c.json(await finishBot(bots, name, { ...rest, ...(avatar ? { avatar } : {}) }), 200)
    } catch (error) {
      const { status, body } = failure(error, name)
      return c.json(body, status)
    } finally {
      inFlight.delete(name)
    }
  })
  return routes
}
