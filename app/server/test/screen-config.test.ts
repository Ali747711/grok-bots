import { beforeEach, describe, expect, it } from 'vitest'

import type { BotDeps } from '../src/bots/create.js'
import { readScreenConfig, ensureIdleStop, setUseScreen } from '../src/bots/screen-config.js'
import { setLogSink } from '../src/log.js'

type Cfg = Record<string, unknown>
interface Call { method: string; path: string; query?: Record<string, string>; body?: unknown }

let config: Cfg
let calls: Call[]
let failPut: Error | null
let deps: BotDeps
const puts = (): Call[] => calls.filter(c => c.method === 'PUT')

beforeEach(() => {
  config = { model: 'secret-model', providers: { k: 'sk-SECRET' }, browser: { headed: false, other: 1 }, bot_desktop: { idle_stop_minutes: 30, auto_start: false } }
  calls = []
  failPut = null
  deps = {
    rpc: async () => { throw new Error('unused') },
    rest: {
      request: async <T>(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> => {
        calls.push({ method, path, ...(opts.query ? { query: opts.query } : {}), ...(opts.body === undefined ? {} : { body: opts.body }) })
        if (method === 'PUT' && failPut) throw failPut
        return (method === 'GET' ? config : { ok: true }) as T
      }
    } as BotDeps['rest'],
    refresh: async () => undefined,
    now: () => 1
  }
})

describe('screen config', () => {
  it('writes a sparse body with the profile query and never PUTs the GET result', async () => {
    await ensureIdleStop(deps, 'scout')
    expect(puts()).toHaveLength(1)
    expect(puts()[0]).toMatchObject({ path: '/api/config', query: { profile: 'scout' }, body: { config: { bot_desktop: { idle_stop_minutes: 15 } } } })
    expect(JSON.stringify(puts()[0]!.body)).not.toContain('secret')
    expect(calls.find(c => c.method === 'GET')?.query).toEqual({ profile: 'scout' })
  })

  it('skips the idle write when the bot already has 15 minutes', async () => {
    config = { bot_desktop: { idle_stop_minutes: 15 } }
    await ensureIdleStop(deps, 'scout')
    expect(puts()).toHaveLength(0)
  })

  it('sets headed and auto_start together and reports useScreen only when both are true', async () => {
    await setUseScreen(deps, 'scout', true)
    expect(puts()[0]!.body).toEqual({ config: { browser: { headed: true }, bot_desktop: { auto_start: true } } })
    expect(puts()[1]!.body).toEqual({ config: { bot_desktop: { idle_stop_minutes: 15 } } })
    expect(await readScreenConfig(deps, 'scout')).toEqual({ idleStopMinutes: 30, headed: false, autoStart: false })
    config = { browser: { headed: true }, bot_desktop: { idle_stop_minutes: 15, auto_start: true } }
    expect(await readScreenConfig(deps, 'scout')).toEqual({ idleStopMinutes: 15, headed: true, autoStart: true })
    config = { browser: { headed: true }, bot_desktop: {} }
    expect(await readScreenConfig(deps, 'scout')).toEqual({ idleStopMinutes: null, headed: true, autoStart: false })
  })

  it('never logs or returns the config GET body', async () => {
    const lines: string[] = []
    const restore = setLogSink(line => lines.push(line))
    try {
      const result = await readScreenConfig(deps, 'scout')
      await ensureIdleStop(deps, 'scout')
      expect(JSON.stringify(result)).not.toContain('SECRET')
      expect(lines.join('\n')).not.toContain('SECRET')
    } finally {
      restore()
    }
  })
})
