import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import { withBotLock } from '../src/bots/bot-lock.js'
import type { BotDeps } from '../src/bots/create.js'
import { HermesUnavailableError } from '../src/hermes/errors.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = { Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

type Cfg = Record<string, unknown>
let config: Cfg
let puts: unknown[]
let clamp: ReturnType<typeof vi.fn>
let listError: Error | null
let app: ReturnType<typeof createApp>
const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })

beforeEach(() => {
  config = { terminal: { backend: 'docker' }, agent: { disabled_toolsets: ['browser'] } }
  puts = []
  clamp = vi.fn()
  listError = null
  const bots: BotDeps = {
    rpc: (async (method: string) => {
      if (method === 'profiles.list' && listError) throw listError
      if (method === 'profiles.list') return { profiles: [{ name: 'scout' }, { name: 'default' }] }
      throw new Error(`unscripted ${method}`)
    }) as BotDeps['rpc'],
    rest: {
      request: async (method: string, _path: string, opts: { body?: unknown } = {}) => {
        if (method === 'PUT') {
          puts.push(opts.body)
          const patch = (opts.body as { config: Cfg }).config
          for (const [k, v] of Object.entries(patch)) config[k] = { ...(config[k] as Cfg), ...(v as Cfg) }
          return { ok: true }
        }
        return config
      }
    } as BotDeps['rest'],
    refresh: async () => undefined,
    now: () => 1,
    apps: { forget: async () => undefined, clamp }
  }
  app = createApp({ ...base, bots })
})

describe('approvals routes', () => {
  it('GET answers {mode, isDefault, sandboxed} for any bot, the primary included', async () => {
    expect(await (await send('GET', '/crew/bots/scout/approvals')).json()).toEqual({ mode: 'smart', isDefault: true, sandboxed: true })
    const res = await send('GET', '/crew/bots/default/approvals')
    expect(res.status).toBe(200)
  })

  it('PUT writes a sparse {approvals:{mode}} under the bot lock and answers the fresh view', async () => {
    let release!: () => void
    const held = withBotLock('scout', () => new Promise<void>(r => { release = r }))
    const pending = send('PUT', '/crew/bots/scout/approvals', { mode: 'manual' })
    await new Promise(r => setTimeout(r, 20))
    expect(puts).toHaveLength(0)
    release()
    await held
    const res = await pending
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ mode: 'manual', isDefault: false, sandboxed: true })
    expect(puts).toEqual([{ config: { approvals: { mode: 'manual' } } }])
    expect(clamp).not.toHaveBeenCalled()
  })

  it('PUT off asks the apps to clamp with the fresh config', async () => {
    await send('PUT', '/crew/bots/scout/approvals', { mode: 'off' })
    expect(clamp).toHaveBeenCalledTimes(1)
    const [bot, raw] = clamp.mock.calls[0] as [string, { approvals: { mode: string } }]
    expect(bot).toBe('scout')
    expect(raw.approvals.mode).toBe('off')
  })

  it('refuses always, an extra key and an empty body with 400 bad_body', async () => {
    for (const body of [{ mode: 'always' }, { mode: 'off', extra: 1 }, {}]) {
      const res = await send('PUT', '/crew/bots/scout/approvals', body)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_body' })
    }
    expect(puts).toHaveLength(0)
  })

  it('refuses the primary with primary_not_supported and writes nothing', async () => {
    const res = await send('PUT', '/crew/bots/default/approvals', { mode: 'off' })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'primary_not_supported' })
    expect(puts).toHaveLength(0)
    expect(clamp).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown bot and 503 when Hermes is offline', async () => {
    expect((await send('GET', '/crew/bots/ghost/approvals')).status).toBe(404)
    expect((await send('PUT', '/crew/bots/ghost/approvals', { mode: 'off' })).status).toBe(404)
    listError = new HermesUnavailableError()
    expect((await send('GET', '/crew/bots/scout/approvals')).status).toBe(503)
    app = createApp({ ...base })
    expect((await send('GET', '/crew/bots/scout/approvals')).status).toBe(503)
  })
})
