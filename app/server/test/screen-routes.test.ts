import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import { withBotLock } from '../src/bots/bot-lock.js'
import type { BotDeps } from '../src/bots/create.js'
import { HermesRestError, HermesRpcError, HermesUnavailableError } from '../src/hermes/errors.js'
import { setLogSink } from '../src/log.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = { Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

type Cfg = Record<string, unknown>
let config: Cfg
let order: string[]
let rpcCalls: { method: string; params: Record<string, unknown> }[]
let putError: Error | null
let getError: Error | null
let startError: Error | null
let listError: Error | null
let restoreLog: () => void
let onStart: (() => Promise<void>) | null
let app: ReturnType<typeof createApp>
const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, { method, headers, ...(payload === undefined ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }) })

beforeEach(() => {
  config = { browser: { headed: false }, bot_desktop: { idle_stop_minutes: 30, auto_start: false } }
  order = []
  rpcCalls = []
  putError = null
  getError = null
  startError = null
  listError = null
  restoreLog = setLogSink(() => undefined)
  onStart = null
  const bots: BotDeps = {
    rpc: (async (method: string, params: Record<string, unknown>) => {
      rpcCalls.push({ method, params })
      order.push(method)
      if (method === 'profiles.list' && listError) throw listError
      if (method === 'profiles.list') return { profiles: [{ name: 'scout' }, { name: 'default' }] }
      if (method === 'display.start' && startError) throw startError
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
        if (getError) throw getError
        return config
      }
    } as BotDeps['rest'],
    refresh: async () => undefined,
    now: () => 1
  }
  app = createApp({ ...base, bots })
})

afterEach(() => restoreLog())

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
    rpcCalls.length = 0
    expect((await send('POST', '/crew/bots/Bad%20Name/screen/start')).status).toBe(404)
    expect(rpcCalls).toHaveLength(0)
    expect((await send('PUT', '/crew/bots/scout/screen/config', { useScreen: 'yes' })).status).toBe(400)
    expect((await send('PUT', '/crew/bots/scout/screen/config', { useScreen: true, extra: 1 })).status).toBe(400)
    expect(order).not.toContain('display.start')
  })

  it('answers 502 with the Hermes detail, or a fixed string for other errors', async () => {
    putError = new HermesRestError(500, 'disk full')
    expect(await (await send('POST', '/crew/bots/scout/screen/start')).json()).toEqual({ error: 'screen_config_failed', message: 'disk full' })
    putError = new SyntaxError('Unexpected token s in {"secret":1}')
    const body = await (await send('POST', '/crew/bots/scout/screen/start')).json() as { message: string }
    expect(body.message).toBe('screen config could not be saved')
    expect(order.filter(o => o === 'display.start')).toHaveLength(0)
  })

  it('answers 404 when the profile vanishes during the idle write', async () => {
    putError = new HermesRestError(404, 'no such profile')
    expect((await send('POST', '/crew/bots/scout/screen/start')).status).toBe(404)
  })

  it('answers 503 when hermes is offline', async () => {
    listError = new HermesUnavailableError()
    expect((await send('POST', '/crew/bots/scout/screen/start')).status).toBe(503)
    expect((await send('GET', '/crew/bots/scout/screen/config')).status).toBe(503)
  })

  it('keeps the 5300 refusal from display.start verbatim', async () => {
    startError = new HermesRpcError(5300, 'Not enough free memory for a desktop')
    const res = await send('POST', '/crew/bots/scout/screen/start')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'hermes_error', message: 'Not enough free memory for a desktop' })
  })

  it('starts the primary bot screen', async () => {
    expect((await send('POST', '/crew/bots/default/screen/start')).status).toBe(200)
    expect(rpcCalls.find(c => c.method === 'display.start')?.params).toMatchObject({ profile: 'default' })
  })

  it('turns useScreen off by writing both keys false', async () => {
    config = { browser: { headed: true }, bot_desktop: { idle_stop_minutes: 15, auto_start: true } }
    expect(await (await send('PUT', '/crew/bots/scout/screen/config', { useScreen: false })).json()).toEqual({ useScreen: false, idleStopMinutes: 15 })
    expect(config.browser).toEqual({ headed: false })
  })

  it('PUT idleStopMinutes 60 writes only bot_desktop.idle_stop_minutes and answers the view', async () => {
    const res = await send('PUT', '/crew/bots/scout/screen/config', { idleStopMinutes: 60 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ useScreen: false, idleStopMinutes: 60 })
    expect(config.browser).toEqual({ headed: false })
    expect((config.bot_desktop as Cfg).auto_start).toBe(false)
  })

  it('refuses idleStopMinutes 30 and an empty body', async () => {
    expect((await send('PUT', '/crew/bots/scout/screen/config', { idleStopMinutes: 30 })).status).toBe(400)
    expect((await send('PUT', '/crew/bots/scout/screen/config', {})).status).toBe(400)
    expect(order).not.toContain('rest PUT')
  })

  it('start keeps a 60-minute choice and writes nothing before display.start', async () => {
    config = { bot_desktop: { idle_stop_minutes: 60 } }
    expect((await send('POST', '/crew/bots/scout/screen/start')).status).toBe(200)
    expect(order).not.toContain('rest PUT')
    expect((config.bot_desktop as Cfg).idle_stop_minutes).toBe(60)
  })

  it('refuses an idle-stop write on the primary', async () => {
    const res = await send('PUT', '/crew/bots/default/screen/config', { idleStopMinutes: 60 })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'primary_not_supported' })
    expect(order).not.toContain('rest PUT')
  })
})
