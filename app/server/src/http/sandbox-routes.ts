import { Hono, type Context } from 'hono'
import { z } from 'zod'

import type { BotDeps } from '../bots/create.js'
import { PROFILE_NAME_RE } from '../bots/names.js'
import { type SandboxDeps, readSandbox, resetSandbox, setSandbox } from '../bots/sandbox.js'
import { BotNotFoundError } from '../bots/ui-meta.js'
import { imageStatus } from '../sandbox/pull.js'
import { failure } from './bot-errors.js'
import type { CrewEnv } from './session-guard.js'

const putBody = z.object({ on: z.boolean() }).strict()

/** Roster check with Hermes's own profile-name rule, so `default` is allowed. */
export async function requireBot(deps: Pick<BotDeps, 'rpc'>, name: string): Promise<void> {
  const list = await deps.rpc<{ profiles: readonly { name: string }[] }>('profiles.list', { include_sessions: false })
  if (!list.profiles.some(p => p.name === name)) throw new BotNotFoundError(name)
}

/** `GET|PUT /crew/bots/:name/sandbox`, `POST …/sandbox/reset`, `GET /crew/sandbox/image`, `POST …/image/pull`. */
export function sandboxRoutes(bots: BotDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  const sb: SandboxDeps | undefined = bots?.sandbox
  routes.use('/crew/bots/:name/sandbox', async (c, next) => guard(c, next))
  routes.use('/crew/bots/:name/sandbox/*', async (c, next) => guard(c, next))
  routes.use('/crew/sandbox/*', async (c, next) => (bots && sb ? next() : c.json({ error: 'hermes_offline' }, 503)))

  function guard(c: Context<CrewEnv>, next: () => Promise<void>): Response | Promise<Response | void> {
    if (!bots || !sb) return c.json({ error: 'hermes_offline' }, 503)
    return PROFILE_NAME_RE.test(c.req.param('name') ?? '') ? next() : c.json({ error: 'not_found' }, 404)
  }

  const guarded = async (name: string, action: (deps: BotDeps, sb: SandboxDeps) => Promise<Response>): Promise<Response> => {
    try {
      await requireBot(bots!, name)
      return await action(bots!, sb!)
    } catch (error) {
      const { status, body } = failure(error, name)
      return Response.json(body, { status })
    }
  }

  routes.get('/crew/bots/:name/sandbox', c => guarded(c.req.param('name'), async (deps, s) => c.json(await readSandbox(deps, s, c.req.param('name')))))

  routes.put('/crew/bots/:name/sandbox', async c => {
    const parsed = putBody.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return c.json({ error: 'bad_body', message: parsed.error.issues[0]?.message ?? 'invalid body' }, 400)
    return guarded(c.req.param('name'), async (deps, s) => c.json(await setSandbox(deps, s, c.req.param('name'), parsed.data.on)))
  })

  routes.post('/crew/bots/:name/sandbox/reset', c => guarded(c.req.param('name'), async (deps, s) => c.json(await resetSandbox(deps, s, c.req.param('name')))))

  routes.get('/crew/sandbox/image', async c => {
    try {
      return c.json(await imageStatus(sb!.docker, sb!.puller))
    } catch (error) {
      const { status, body } = failure(error, '')
      return c.json(body, status)
    }
  })

  routes.post('/crew/sandbox/image/pull', async c => {
    try {
      const before = await imageStatus(sb!.docker, sb!.puller)
      if (before.docker !== 'ok') return c.json({ error: 'docker_unavailable' }, 409)
      if (before.present) return c.json(before)
      // start() is a no-op while a pull runs, so two clicks or two tabs share one `docker pull`.
      sb!.puller.start()
      return c.json(await imageStatus(sb!.docker, sb!.puller), 202)
    } catch (error) {
      const { status, body } = failure(error, '')
      return c.json(body, status)
    }
  })
  return routes
}
