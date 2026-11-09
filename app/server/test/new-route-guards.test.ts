import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import type { BotDeps } from '../src/bots/create.js'
import type { RoutineService } from '../src/routines/service.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const cookie = `crew_session=${session}; ${CSRF_COOKIE}=tok`

/** Every mutating route added in Phase 2. Both calls must be refused before any handler runs. */
const MUTATING: readonly (readonly [string, string])[] = [
  ['POST', '/crew/bots'],
  ['POST', '/crew/bots/scout/finish'],
  ['PATCH', '/crew/bots/scout'],
  ['PUT', '/crew/bots/scout/avatar'],
  ['DELETE', '/crew/bots/scout/avatar'],
  ['DELETE', '/crew/bots/scout'],
  ['POST', '/crew/routines?bot=scout'],
  ['PUT', '/crew/routines/abc?bot=scout'],
  ['DELETE', '/crew/routines/abc?bot=scout'],
  ['POST', '/crew/routines/abc/pause?bot=scout'],
  ['POST', '/crew/routines/abc/resume?bot=scout'],
  ['POST', '/crew/routines/abc/run?bot=scout'],
  ['POST', '/crew/routines/preview'],
  ['PUT', '/crew/settings']
]

function app() {
  const rpc = new FakeRpc()
  const rest = new FakeRest()
  const bots: BotDeps = { rpc: rpc.call, rest: { request: rest.request } as BotDeps['rest'], refresh: async () => undefined, now: () => 1 }
  const calls: string[] = []
  const routines = new Proxy({}, { get: (_t, name) => () => { calls.push(String(name)); return Promise.resolve({}) } }) as unknown as RoutineService
  const settings = { get: () => ({ maxWorkingBots: 2 }), update: async () => { calls.push('settings'); return { maxWorkingBots: 2 } } }
  return { app: createApp({ ...base, bots, routines, settings }), rpc, rest, calls }
}

describe('guards on the Phase 2 mutating routes', () => {
  it.each(MUTATING)('%s %s is refused without an Origin (403)', async (method, path) => {
    const { app: a, rpc, rest, calls } = app()
    const res = await a.request(path, { method, headers: { Host: HOST, Cookie: cookie, 'X-Crew-CSRF': 'tok', 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' })
    expect(res.status).toBe(403)
    expect([rpc.calls.length, rest.requests.length, calls.length]).toEqual([0, 0, 0])
  })

  it.each(MUTATING)('%s %s is refused with an Origin but no CSRF header (403)', async (method, path) => {
    const { app: a, rpc, rest, calls } = app()
    const res = await a.request(path, { method, headers: { Host: HOST, Origin: ORIGIN, Cookie: cookie, 'Content-Type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' })
    expect(res.status).toBe(403)
    expect([rpc.calls.length, rest.requests.length, calls.length]).toEqual([0, 0, 0])
  })

  it('lets a request with Origin and CSRF through (control: the table is not 403-everything)', async () => {
    const { app: a } = app()
    const res = await a.request('/crew/settings', { method: 'PUT', headers: { Host: HOST, Origin: ORIGIN, Cookie: cookie, 'X-Crew-CSRF': 'tok', 'Content-Type': 'application/json' }, body: JSON.stringify({ maxWorkingBots: 3 }) })
    expect(res.status).toBe(200)
  })
})
