import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import { withBotLock } from '../src/bots/bot-lock.js'
import type { BotDeps } from '../src/bots/create.js'
import { HermesRestError } from '../src/hermes/errors.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = { Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

type Cfg = Record<string, unknown>
let config: Cfg
let order: string[]
let rpcCalls: { method: string; params: Record<string, unknown> }[]
let putError: Error | null
let onStart: (() => Promise<void>) | null
let app: ReturnType<typeof createApp>
const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, { method, headers, ...(payload === undefined ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }) })

beforeEach(() => {
  config = { browser: { headed: false }, bot_desktop: { idle_stop_minutes: 30, auto_start: false } }
  order = []
  rpcCalls = []
  putError = null
  onStart = null
  const bots: BotDeps = {
    rpc: (async (method: string, params: Record<string, unknown>) => {
      rpcCalls.push({ method, params })
      order.push(method)
      if (method === 'profiles.list') return { profiles: [{ name: 'scout' }, { name: 'default' }] }
      if (method === 'display.start') { await onStart?.(); return { profile: params.profile, running: true } }
      throw new Error(`unscripted ${method}`)
    }) as BotDeps['rpc'],
    rest: {
      request: async (method: string, _path: string, opts: { body?: unknown } = {}) => {
        order.push(`rest ${method}`)
        if (method === 'PUT' && putError) throw putError
        if (method === 'PUT') {
          const body = (opts.body as { config: Cfg }).config
          for (const [k, v] of Object.entries(body)) config[k] = { ...(config[k] as Cfg), ...(v as Cfg) }
          return { ok: true }
        }
        return config
      }
    } as BotDeps['rest'],
    refresh: async () => undefined,
    now: () => 1
  }
  app = createApp({ ...base, bots })
})

describe('screen routes', () => {
  it('starts the screen after ensuring idle stop and returns the status', async () => {
    const res = await send('POST', '/crew/bots/scout/screen/start')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ profile: 'scout', running: true })
    expect(rpcCalls.find(c => c.method === 'display.start')?.params).toMatchObject({ profile: 'scout' })
    expect(order.indexOf('rest PUT')).toBeLessThan(order.indexOf('display.start'))
    expect((config.bot_desktop as Cfg).idle_stop_minutes).toBe(15)
  })

  it('refuses to start when the idle write fails (502, no display.start)', async () => {
    putError = new HermesRestError(500, 'disk full')
    const res = await send('POST', '/crew/bots/scout/screen/start')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'screen_config_failed' })
    expect(order).not.toContain('display.start')
  })

  it('holds the bot lock for the config write but not across display.start', async () => {
    let lockedDuringStart = true
    onStart = async () => {
      let ran = false
      await withBotLock('scout', async () => { ran = true })
      lockedDuringStart = !ran
    }
    await send('POST', '/crew/bots/scout/screen/start')
    expect(lockedDuringStart).toBe(false)
    order.length = 0
    config = { bot_desktop: { idle_stop_minutes: 30 } }
    let release!: () => void
    const held = withBotLock('scout', () => new Promise<void>(r => { release = r }))
    const pending = send('POST', '/crew/bots/scout/screen/start')
    await new Promise(r => setTimeout(r, 20))
    expect(order.filter(o => o === 'rest PUT')).toHaveLength(0) // queued behind the held lock
    release()
    await held
    expect((await pending).status).toBe(200)
    expect(order.filter(o => o === 'rest PUT')).toHaveLength(1)
  })

  it('reads and sets useScreen with the idle stop', async () => {
    expect(await (await send('GET', '/crew/bots/scout/screen/config')).json()).toEqual({ useScreen: false, idleStopMinutes: 30 })
    const res = await send('PUT', '/crew/bots/scout/screen/config', { useScreen: true })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ useScreen: true, idleStopMinutes: 15 })
    expect(config.browser).toEqual({ headed: true })
  })

  it('rejects useScreen for the primary bot and unknown or malformed names', async () => {
    expect((await send('PUT', '/crew/bots/default/screen/config', { useScreen: true })).status).toBe(400)
    expect((await send('GET', '/crew/bots/default/screen/config')).status).toBe(200)
    expect((await send('GET', '/crew/bots/ghost/screen/config')).status).toBe(404)
    expect((await send('POST', '/crew/bots/ghost/screen/start')).status).toBe(404)
    expect((await send('POST', '/crew/bots/Bad%20Name/screen/start')).status).toBe(404)
    expect((await send('PUT', '/crew/bots/scout/screen/config', { useScreen: 'yes' })).status).toBe(400)
    expect((await send('PUT', '/crew/bots/scout/screen/config', { useScreen: true, extra: 1 })).status).toBe(400)
    expect(order).not.toContain('display.start')
  })
})
