import { beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import { HermesRestError, HermesUnavailableError } from '../src/hermes/errors.js'
import type { RoutineInput, RoutineService, RoutineView, RunView } from '../src/routines/service.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps(Date.parse('2026-11-08T12:00:00Z'))
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = { Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

const view: RoutineView = {
  id: 'abc', bot: 'scout', title: 'T', instruction: 'I', schedule: { kind: 'daily', time: '09:00' }, scheduleText: '0 9 * * *', timezone: 'UTC',
  deliverToChat: false, enabled: true, nextRunAt: null, lastRunAt: null, lastStatus: null, lastError: null, running: false, state: 'scheduled', finished: false
}
const body: RoutineInput = { title: 'Morning', instruction: 'Do it', schedule: { kind: 'daily', time: '09:00' }, timezone: 'Asia/Seoul', deliverToChat: false }

let calls: unknown[][]
let overrides: Partial<Record<keyof RoutineService, (...args: never[]) => unknown>>
let app: ReturnType<typeof createApp>
const send = (method: string, path: string, payload?: unknown, extra: Record<string, string> = {}) =>
  app.request(path, { method, headers: { ...headers, ...extra }, ...(payload === undefined ? {} : { body: typeof payload === 'string' ? payload : JSON.stringify(payload) }) })

beforeEach(() => {
  calls = []
  overrides = {}
  const record = <K extends keyof RoutineService>(name: K, fallback: unknown) => (...args: unknown[]) => {
    calls.push([name, ...args])
    const o = overrides[name]
    return Promise.resolve(o ? (o as (...a: unknown[]) => unknown)(...args) : fallback)
  }
  const routines = {
    list: record('list', [view]), create: record('create', view), update: record('update', view), pause: record('pause', view), resume: record('resume', view),
    remove: record('remove', undefined), runNow: record('runNow', 'started'), runs: record('runs', [] as RunView[])
  } as unknown as RoutineService
  app = createApp({ ...base, routines })
})

describe('guards and validation', () => {
  it('requires a valid bot query, and a valid routine id', async () => {
    for (const path of ['/crew/routines', '/crew/routines?bot=Bad', '/crew/routines?bot=']) {
      const res = await send('GET', path)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_bot' })
    }
    for (const id of ['a.b', 'x'.repeat(65), 'a%20b']) {
      const res = await send('POST', `/crew/routines/${id}/pause?bot=scout`)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_id' })
    }
    expect(calls).toEqual([])
  })

  it('requires the CSRF header on mutations and a session', async () => {
    expect((await send('POST', '/crew/routines?bot=scout', body, { 'X-Crew-CSRF': '' })).status).toBe(403)
    expect((await app.request('/crew/routines?bot=scout', { headers: { Host: HOST } })).status).toBe(401)
  })

  it('answers 503 hermes_offline when routines are not wired or hermes is unavailable', async () => {
    const res = await createApp(base).request('/crew/routines?bot=scout', { headers })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'hermes_offline' })
    overrides.list = () => { throw new HermesUnavailableError() }
    expect((await send('GET', '/crew/routines?bot=scout')).status).toBe(503)
  })
})

describe('routine routes', () => {
  it('lists, creates (201), updates, pauses, resumes and deletes (204)', async () => {
    expect(await (await send('GET', '/crew/routines?bot=scout')).json()).toEqual([view])
    const created = await send('POST', '/crew/routines?bot=scout', body)
    expect(created.status).toBe(201)
    expect(calls.at(-1)).toEqual(['create', 'scout', body])
    expect((await send('PUT', '/crew/routines/abc?bot=scout', body)).status).toBe(200)
    expect(calls.at(-1)).toEqual(['update', 'scout', 'abc', body])
    expect((await send('POST', '/crew/routines/abc/pause?bot=scout')).status).toBe(200)
    expect((await send('POST', '/crew/routines/abc/resume?bot=scout')).status).toBe(200)
    expect((await send('DELETE', '/crew/routines/abc?bot=scout')).status).toBe(204)
    expect(calls.map(c => c[0])).toEqual(['list', 'create', 'update', 'pause', 'resume', 'remove'])
  })

  it('accepts timezoneChanged on update and passes it through', async () => {
    expect((await send('PUT', '/crew/routines/abc?bot=scout', { ...body, timezoneChanged: true })).status).toBe(200)
    expect(calls.at(-1)).toEqual(['update', 'scout', 'abc', { ...body, timezoneChanged: true }])
    expect((await send('PUT', '/crew/routines/abc?bot=scout', { ...body, timezoneChanged: 'yes' })).status).toBe(400)
  })

  it('rejects bad bodies with 400 bad_body and never calls the service', async () => {
    for (const payload of [
      { ...body, title: '' }, { ...body, title: 'x'.repeat(81) }, { ...body, instruction: '' }, { ...body, instruction: 'x'.repeat(4001) },
      { ...body, timezone: 'Mars/Base' }, { ...body, schedule: { kind: 'every', amount: 0, unit: 'h' } }, { ...body, schedule: { kind: 'every', amount: 1000, unit: 'h' } },
      { ...body, schedule: { kind: 'weekly', day: 7, time: '09:00' } }, { ...body, schedule: { kind: 'daily', time: '9:00' } }, { ...body, schedule: { kind: 'nope' } },
      { ...body, deliverToChat: 'yes' }, '{'
    ]) {
      const res = await send('POST', '/crew/routines?bot=scout', payload)
      expect(res.status).toBe(400)
      expect(await res.json()).toMatchObject({ error: 'bad_body' })
    }
    expect(calls).toEqual([])
  })

  it("passes Hermes's rejection message through verbatim as 400 rejected, and maps 404", async () => {
    overrides.create = () => { throw new HermesRestError(400, 'Blocked: prompt matches a threat pattern') }
    const res = await send('POST', '/crew/routines?bot=scout', body)
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'rejected', message: 'Blocked: prompt matches a threat pattern' })
    overrides.remove = () => { throw new HermesRestError(404, 'Job not found') }
    expect((await send('DELETE', '/crew/routines/abc?bot=scout')).status).toBe(404)
  })

  it('answers 502 hermes_error for an unexpected failure', async () => {
    overrides.list = () => { throw new Error('boom') }
    const res = await send('GET', '/crew/routines?bot=scout')
    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ error: 'hermes_error' })
  })

  it('run answers 202 started or 409 already_running', async () => {
    const started = await send('POST', '/crew/routines/abc/run?bot=scout')
    expect(started.status).toBe(202)
    expect(await started.json()).toEqual({ status: 'started' })
    overrides.runNow = () => 'already_running'
    const busy = await send('POST', '/crew/routines/abc/run?bot=scout')
    expect(busy.status).toBe(409)
    expect(await busy.json()).toEqual({ status: 'already_running' })
  })

  it('run answers 409 finished with a plain message for a one-time routine that already ran', async () => {
    overrides.runNow = () => 'finished'
    const res = await send('POST', '/crew/routines/abc/run?bot=scout')
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ status: 'finished', message: 'This one-time routine has already run.' })
  })

  it('runs honours limit 1-100 with default 20', async () => {
    await send('GET', '/crew/routines/abc/runs?bot=scout')
    expect(calls.at(-1)).toEqual(['runs', 'scout', 'abc', 20])
    await send('GET', '/crew/routines/abc/runs?bot=scout&limit=100')
    expect(calls.at(-1)).toEqual(['runs', 'scout', 'abc', 100])
    for (const limit of ['0', '101', 'x', '2.5']) expect((await send('GET', `/crew/routines/abc/runs?bot=scout&limit=${limit}`)).status).toBe(400)
  })
})

describe('POST /crew/routines/preview', () => {
  it('returns the next runs without a bot', async () => {
    const res = await send('POST', '/crew/routines/preview', { schedule: { kind: 'daily', time: '09:00' }, timezone: 'Asia/Seoul' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ next: [Date.parse('2026-11-09T00:00:00Z'), Date.parse('2026-11-10T00:00:00Z'), Date.parse('2026-11-11T00:00:00Z')] })
  })

  it('answers 400 in_past and invalid with a message', async () => {
    const past = await send('POST', '/crew/routines/preview', { schedule: { kind: 'once_at', at: '2026-11-08T09:00' }, timezone: 'UTC' })
    expect(past.status).toBe(400)
    expect(await past.json()).toMatchObject({ error: 'in_past', message: expect.any(String) })
    const bad = await send('POST', '/crew/routines/preview', { schedule: { kind: 'cron', expr: 'nope' }, timezone: 'UTC' })
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'invalid' })
    expect((await send('POST', '/crew/routines/preview', { schedule: { kind: 'daily', time: '09:00' }, timezone: 'Mars/Base' })).status).toBe(400)
  })
})
