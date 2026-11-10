import { Hono, type Context } from 'hono'
import { z } from 'zod'

import { PROFILE_NAME_RE } from '../bots/names.js'
import { BotNotFoundError } from '../bots/ui-meta.js'
import {
  AlreadyConnectedError, disconnect, listApps, pollConnect, removeKey, saveKey, startConnect
} from '../connectors/account.js'
import { AppsRefusedError, type ConnectorDeps, readBotApps, setBotApps } from '../connectors/bot-apps.js'
import { ComposioError } from '../connectors/composio.js'
import { KEY_RE, type KeyStore } from '../connectors/key.js'
import { APP_LEVELS, TOOLKIT_RE, type AppLevel } from '../connectors/levels.js'
import { HermesRestError, HermesUnavailableError } from '../hermes/errors.js'
import { log } from '../log.js'
import type { Failure } from './bot-errors.js'
import { requireBot } from './sandbox-routes.js'
import type { CrewEnv } from './session-guard.js'

export interface ConnectorRouteDeps { readonly connectors: ConnectorDeps; readonly keys: KeyStore }

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const keyBody = z.object({ key: z.string().regex(KEY_RE) }).strict()
const connectBody = z.object({ toolkit: z.string().regex(TOOLKIT_RE) }).strict()
const appsBody = z.record(z.string().regex(TOOLKIT_RE), z.enum(APP_LEVELS as [AppLevel, ...AppLevel[]]))
  .refine(apps => Object.keys(apps).length <= 20)
const searchQuery = z.string().trim().max(60)

class BodyError extends Error {}

const codeOf = (error: string, status: Failure['status']): Failure => ({ status, body: { error } })

/** Codes only, never a message: nothing an upstream said can reach a reply. */
export function connectorFailure(error: unknown, route: string): Failure {
  if (error instanceof ComposioError || error instanceof AppsRefusedError) {
    const status = { no_key: 409, key_rejected: 409, composio_unavailable: 502, not_found: 404, level_unavailable: 409, unknown_app: 400 } as const
    return codeOf(error.code, status[error.code])
  }
  if (error instanceof AlreadyConnectedError) return codeOf('already_connected', 409)
  if (error instanceof HermesUnavailableError) return codeOf('hermes_offline', 503)
  if (error instanceof BotNotFoundError || (error instanceof HermesRestError && error.status === 404)) return codeOf('not_found', 404)
  if (error instanceof BodyError) return codeOf('bad_body', 400)
  log.warn('apps request failed', { route, kind: error instanceof Error ? error.name : 'unknown' })
  return codeOf('apps_failed', 502)
}

async function jsonBody<T>(c: Context<CrewEnv>, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) throw new BodyError()
  return parsed.data
}

function checked(value: string | undefined, ok: (v: string) => boolean): string {
  if (value === undefined || !ok(value)) throw new BodyError()
  return value
}

/** `/crew/connectors/*` and `/crew/bots/:name/apps`, behind the normal guards. */
export function connectorRoutes(deps: ConnectorRouteDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.use('/crew/connectors/*', async (c, next) => (deps ? next() : c.json({ error: 'apps_unavailable' }, 503)))
  routes.use('/crew/bots/:name/apps', async (c, next) => (deps ? next() : c.json({ error: 'apps_unavailable' }, 503)))

  const run = (route: string, action: (d: ConnectorRouteDeps, c: Context<CrewEnv>) => Promise<Response>) =>
    async (c: Context<CrewEnv>): Promise<Response> => {
      try {
        return await action(deps!, c)
      } catch (error) {
        const { status, body } = connectorFailure(error, route)
        return c.json(body, status)
      }
    }
  const idOf = (c: Context<CrewEnv>): string => checked(c.req.param('id'), v => ID_RE.test(v))
  const botOf = async (d: ConnectorRouteDeps, c: Context<CrewEnv>): Promise<string> => {
    const name = c.req.param('name') ?? ''
    if (!PROFILE_NAME_RE.test(name)) throw new BotNotFoundError(name)
    await requireBot(d.connectors.bots, name)
    return name
  }

  routes.get('/crew/connectors/key', run('key.get', async (d, c) => c.json({ configured: d.keys.get() !== null })))
  routes.put('/crew/connectors/key', run('key.put', async (d, c) => {
    await saveKey(d.connectors, d.keys, (await jsonBody(c, keyBody)).key)
    return c.json({ configured: true })
  }))
  routes.delete('/crew/connectors/key', run('key.delete', async (d, c) => {
    await removeKey(d.connectors, d.keys)
    return c.body(null, 204)
  }))
  routes.get('/crew/connectors/apps', run('apps.list', async (d, c) => c.json(await listApps(d.connectors))))
  routes.get('/crew/connectors/toolkits', run('toolkits', async (d, c) => {
    const search = searchQuery.safeParse(c.req.query('search') ?? '')
    if (!search.success) throw new BodyError()
    return c.json({ toolkits: await d.connectors.composio.searchToolkits(search.data) })
  }))
  routes.post('/crew/connectors/connect', run('connect', async (d, c) => {
    const { toolkit } = await jsonBody(c, connectBody)
    return c.json(await startConnect(d.connectors, toolkit))
  }))
  routes.get('/crew/connectors/connect/:id', run('connect.poll', async (d, c) =>
    c.json({ state: await pollConnect(d.connectors, idOf(c)) })))
  routes.delete('/crew/connectors/apps/:id', run('apps.delete', async (d, c) => {
    await disconnect(d.connectors, idOf(c))
    return c.body(null, 204)
  }))
  routes.get('/crew/bots/:name/apps', run('bot.apps.get', async (d, c) =>
    c.json(await readBotApps(d.connectors, await botOf(d, c)))))
  routes.put('/crew/bots/:name/apps', run('bot.apps.put', async (d, c) => {
    const bot = await botOf(d, c)
    return c.json(await setBotApps(d.connectors, bot, await jsonBody(c, appsBody)))
  }))
  return routes
}
