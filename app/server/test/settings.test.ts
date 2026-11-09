import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import { setLogSink } from '../src/log.js'
import { SettingsStore } from '../src/settings/settings-store.js'
import type { CrewState } from '../src/watcher/bot-state.js'
import { startWatcher, type WatcherClient } from '../src/watcher/watcher.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = (csrf = true) => ({
  Host: HOST,
  Origin: ORIGIN,
  Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`,
  'Content-Type': 'application/json',
  ...(csrf ? { 'X-Crew-CSRF': 'tok' } : {})
})

let dir: string
let file: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'crew-settings-'))
  file = join(dir, 'nested', 'settings.json')
})

const put = (app: ReturnType<typeof createApp>, body: unknown, csrf = true) =>
  app.request('/crew/settings', { method: 'PUT', headers: headers(csrf), body: JSON.stringify(body) })

describe('SettingsStore', () => {
  it('starts with defaults when the file is missing', async () => {
    expect((await SettingsStore.load(file)).get()).toEqual({ maxWorkingBots: 2 })
  })

  it('persists an update and reloads it', async () => {
    const store = await SettingsStore.load(file)
    expect(await store.update({ maxWorkingBots: null })).toEqual({ maxWorkingBots: null })
    expect((await SettingsStore.load(file)).get()).toEqual({ maxWorkingBots: null })
    expect((await stat(file)).mode & 0o777).toBe(0o600)
  })

  it('falls back to defaults on a corrupt file and warns once', async () => {
    await SettingsStore.load(file).then(s => s.update({ maxWorkingBots: 5 }))
    await writeFile(file, '{')
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    try {
      expect((await SettingsStore.load(file)).get()).toEqual({ maxWorkingBots: 2 })
    } finally {
      restore()
    }
    expect(lines.filter(l => JSON.parse(l).level === 'warn')).toHaveLength(1)
  })

  it('notifies listeners on update until unsubscribed', async () => {
    const store = await SettingsStore.load(file)
    const fn = vi.fn()
    const off = store.onChange(fn)
    await store.update({ maxWorkingBots: 3 })
    off()
    await store.update({ maxWorkingBots: 4 })
    expect(fn).toHaveBeenCalledTimes(1)
  })
})

describe('settings routes', () => {
  it('GET returns the settings and PUT updates them', async () => {
    const settings = await SettingsStore.load(file)
    const app = createApp({ ...base, settings })
    const get = await app.request('/crew/settings', { headers: headers() })
    expect(await get.json()).toEqual({ maxWorkingBots: 2 })
    const res = await put(app, { maxWorkingBots: 7 })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ maxWorkingBots: 7 })
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ maxWorkingBots: 7 })
  })

  it('accepts null (no limit) and the 1 and 20 bounds', async () => {
    const app = createApp({ ...base, settings: await SettingsStore.load(file) })
    for (const value of [null, 1, 20]) expect((await put(app, { maxWorkingBots: value })).status).toBe(200)
  })

  it('rejects out-of-range limits and leaves the file unchanged', async () => {
    const settings = await SettingsStore.load(file)
    await settings.update({ maxWorkingBots: 3 })
    const before = await readFile(file, 'utf8')
    const app = createApp({ ...base, settings })
    for (const value of [0, 21, 2.5, 'x', undefined]) {
      const res = await put(app, { maxWorkingBots: value })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'bad_body' })
    }
    expect((await app.request('/crew/settings', { method: 'PUT', headers: headers(), body: '{' })).status).toBe(400)
    expect(await readFile(file, 'utf8')).toBe(before)
    expect(settings.get()).toEqual({ maxWorkingBots: 3 })
  })

  it('refuses a PUT without the CSRF header and requires a session', async () => {
    const app = createApp({ ...base, settings: await SettingsStore.load(file) })
    expect((await put(app, { maxWorkingBots: 4 }, false)).status).toBe(403)
    const res = await app.request('/crew/settings', { headers: { Host: HOST } })
    expect(res.status).toBe(401)
  })

  it('broadcasts the new settings in /crew/state over SSE', async () => {
    const settings = await SettingsStore.load(file)
    const client: WatcherClient = {
      close: () => undefined, onRequest: () => () => undefined, onEvent: () => () => undefined, onState: () => () => undefined,
      request: () => new Promise(() => undefined)
    }
    const watcher = startWatcher({ client, connect: () => new Promise(() => undefined), now: () => 1, reconnectDelayMs: () => 60_000, settings })
    const app = createApp({ ...base, watcher, settings })
    const controller = new AbortController()
    const res = await app.request('/crew/events', { headers: headers(), signal: controller.signal })
    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    const next = async (): Promise<CrewState> => {
      let text = ''
      while (!text.includes('\n\n')) text += decoder.decode((await reader.read()).value)
      return JSON.parse(text.split('\n').find(l => l.startsWith('data:'))!.slice(5)) as CrewState
    }
    expect((await next()).settings).toEqual({ maxWorkingBots: 2 })
    expect((await put(app, { maxWorkingBots: 4 })).status).toBe(200)
    expect((await next()).settings.maxWorkingBots).toBe(4)
    controller.abort()
    await reader.cancel().catch(() => undefined)
    watcher.stop()
  })
})

