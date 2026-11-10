import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { chmod } from 'node:fs/promises'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import { HermesUnavailableError } from '../src/hermes/errors.js'
import { createHookHandler } from '../src/triggers/hook-handler.js'
import { createLimiter, DEFAULT_LIMITS } from '../src/triggers/limits.js'
import type { EventInput, StartResult } from '../src/triggers/runner.js'
import { setLogSink } from '../src/log.js'
import type { HookHandler } from '../src/triggers/hook-handler.js'
import { sampleEvent } from '../src/triggers/sample-event.js'
import { TriggerStore } from '../src/triggers/store.js'
import type { Trigger } from '../src/triggers/types.js'
import { verifyGeneric, verifyGithub } from '../src/triggers/verify.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = { Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

let dir: string
let store: TriggerStore
let app: ReturnType<typeof createApp>
let handled: { id: string; raw: Buffer | null; headers: Headers }[]
let lines: string[]
let restoreLog: () => void
let routinesList: () => Promise<{ id: string }[]>
let ids: number
let secrets: number

const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })
const hex = (n: number, len: number) => n.toString(16).padStart(len, '0')

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trig-routes-'))
  store = await TriggerStore.load(join(dir, 'triggers.json'))
  handled = []
  lines = []
  ids = 0
  secrets = 0
  restoreLog = setLogSink(l => { lines.push(l) })
  routinesList = async () => [{ id: 'rt1' }]
  const hooks: HookHandler = {
    handle: async (id, raw, h) => {
      handled.push({ id, raw, headers: h })
      return { status: 202, body: { status: 'accepted', event: 'issues', eventId: 'e' }, event: { id: 'e', at: 1, deliveryId: null, eventType: 'issues', action: null, outcome: 'started', jobId: 'j', runId: null, endedAt: null, detail: null } }
    }
  }
  app = createApp({
    ...base,
    triggers: {
      store, hooks, routines: { list: () => routinesList() } as never, hookUrl: id => `http://127.0.0.1:7070/hooks/${id}`, now: () => 1_762_680_000_000,
      newTriggerId: () => hex(++ids, 32), newSecret: () => hex(++secrets, 64), newId: () => 'delivery-1'
    }
  })
})
afterEach(async () => {
  await chmod(dir, 0o700).catch(() => undefined)
  restoreLog()
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

const create = async (over: Record<string, unknown> = {}) => {
  const res = await send('POST', '/crew/bots/crew-test/triggers', { routineId: 'rt1', name: 'Pushes', source: 'github', events: ['issues'], actions: ['opened'], ...over })
  return { res, json: (await res.json()) as { trigger: Trigger & { url: string }; secret: string; url: string } }
}

describe('create', () => {
  it('creates a trigger for a routine of the bot and shows the secret only in that reply', async () => {
    const { res, json } = await create({ events: ['issues', 'issues'], actions: ['opened', 'opened'] })
    expect(res.status).toBe(201)
    expect(json.secret).toMatch(/^[0-9a-f]{64}$/)
    expect(json.url).toBe(`http://127.0.0.1:7070/hooks/${json.trigger.id}`)
    expect(json.trigger).toMatchObject({ bot: 'crew-test', routineId: 'rt1', name: 'Pushes', source: 'github', events: ['issues'], actions: ['opened'], enabled: true, lastEvent: null })
    expect(json.trigger).not.toHaveProperty('secret')
    expect(store.get(json.trigger.id)?.secret).toBe(json.secret)
    const list = await send('GET', '/crew/bots/crew-test/triggers')
    expect(JSON.stringify(await list.json())).not.toContain(json.secret)
  })

  it("refuses a routine that is not the bot's, and answers 503 when Hermes is down", async () => {
    const { res, json } = await create({ routineId: 'other' })
    expect(res.status).toBe(404)
    expect(json).toEqual({ error: 'routine_not_found' })
    expect(store.all()).toEqual([])
    routinesList = async () => { throw new HermesUnavailableError() }
    expect((await create()).res.status).toBe(503)
    expect(store.all()).toEqual([])
  })

  it('refuses actions on a Generic trigger, bad event names and unknown keys', async () => {
    expect((await create({ source: 'generic', actions: ['opened'] })).res.status).toBe(400)
    expect((await create({ events: ['bad name!'] })).res.status).toBe(400)
    expect((await create({ events: Array.from({ length: 21 }, (_, i) => `e${i}`) })).res.status).toBe(400)
    expect((await create({ routineId: 'bad id' })).res.status).toBe(400)
    expect((await create({ name: '   ' })).res.status).toBe(400)
    expect((await create({ extra: 1 })).res.status).toBe(400)
    expect((await send('POST', '/crew/bots/Bad!/triggers', {})).status).toBe(400)
    expect(store.all()).toEqual([])
    expect((await create({ source: 'generic', actions: [] })).res.status).toBe(201)
  })
})

describe('list, patch, secret, delete, events', () => {
  it('lists triggers with their last event', async () => {
    const { json } = await create()
    await store.logEvent(json.trigger.id, { id: 'e1', at: 5, deliveryId: null, eventType: 'issues', action: null, outcome: 'finished', jobId: null, runId: 's1', endedAt: 6, detail: null })
    const other = await send('GET', '/crew/bots/scout/triggers')
    expect(await other.json()).toEqual({ triggers: [] })
    const body = (await (await send('GET', '/crew/bots/crew-test/triggers')).json()) as { triggers: { id: string; lastEvent: { id: string } }[] }
    expect(body.triggers).toHaveLength(1)
    expect(body.triggers[0]?.lastEvent.id).toBe('e1')
  })

  it('patches name, switch and filters, and refuses empty or Generic-action patches', async () => {
    const { json } = await create()
    const id = json.trigger.id
    const res = await send('PATCH', `/crew/triggers/${id}`, { name: ' Renamed ', enabled: false, events: ['push', 'push'], actions: [] })
    expect(await res.json()).toMatchObject({ name: 'Renamed', enabled: false, events: ['push'], actions: [] })
    expect(JSON.stringify(await (await send('PATCH', `/crew/triggers/${id}`, { enabled: true })).json())).not.toContain(json.secret)
    expect((await send('PATCH', `/crew/triggers/${id}`, {})).status).toBe(400)
    expect((await send('PATCH', `/crew/triggers/${id}`, { secret: 'x' })).status).toBe(400)
    const gen = await create({ source: 'generic', actions: [] })
    expect((await send('PATCH', `/crew/triggers/${gen.json.trigger.id}`, { actions: ['opened'] })).status).toBe(400)
  })

  it('issues a new secret and the old one stops verifying', async () => {
    const { json } = await create()
    const res = await send('POST', `/crew/triggers/${json.trigger.id}/secret`)
    const next = ((await res.json()) as { secret: string }).secret
    expect(next).toMatch(/^[0-9a-f]{64}$/)
    expect(next).not.toBe(json.secret)
    const t = store.get(json.trigger.id)!
    const old = sampleEvent({ ...t, secret: json.secret }, 1, 'd')
    expect(verifyGithub(old.raw, old.headers, t.secret).ok).toBe(false)
    const fresh = sampleEvent(t, 1, 'd')
    expect(verifyGithub(fresh.raw, fresh.headers, t.secret).ok).toBe(true)
  })

  it('deletes a trigger with its events', async () => {
    const { json } = await create()
    const id = json.trigger.id
    await store.logEvent(id, { id: 'e1', at: 5, deliveryId: null, eventType: 'issues', action: null, outcome: 'ignored', jobId: null, runId: null, endedAt: null, detail: null })
    const ev = await send('GET', `/crew/triggers/${id}/events`)
    expect(((await ev.json()) as { events: unknown[] }).events).toHaveLength(1)
    expect((await send('DELETE', `/crew/triggers/${id}`)).status).toBe(204)
    expect((await send('GET', `/crew/triggers/${id}/events`)).status).toBe(404)
    expect(store.events(id)).toEqual([])
  })

  it('never returns the secret from any route but create and new-secret', async () => {
    const { json } = await create()
    const id = json.trigger.id
    const texts = [
      await (await send('GET', '/crew/bots/crew-test/triggers')).text(),
      await (await send('PATCH', `/crew/triggers/${id}`, { name: 'n' })).text(),
      await (await send('GET', `/crew/triggers/${id}/events`)).text(),
      await (await send('POST', `/crew/triggers/${id}/test`)).text(),
      await (await send('GET', '/crew/triggers/zz/events')).text(),
      await (await send('PATCH', `/crew/triggers/${id}`, { bogus: 1 })).text()
    ]
    expect(texts.join('\n') + lines.join('\n')).not.toContain(json.secret)
  })
})

describe('send test event', () => {
  it('sends a signed sample through the handler in-process', async () => {
    const { json } = await create({ events: ['issues'], actions: ['reopened'] })
    const res = await send('POST', `/crew/triggers/${json.trigger.id}/test`)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ httpStatus: 202, event: { outcome: 'started' } })
    const call = handled[0]!
    expect(call.id).toBe(json.trigger.id)
    expect(verifyGithub(call.raw!, call.headers, json.secret)).toMatchObject({ ok: true, eventType: 'issues', deliveryId: 'delivery-1' })
    expect(JSON.parse(call.raw!.toString())).toMatchObject({ action: 'reopened', issue: { number: 1, title: 'Test event from Crew' }, repository: { full_name: 'example/repo' } })
  })

  it('signs a Generic sample with the timestamp scheme and defaults', async () => {
    const { json } = await create({ source: 'generic', events: [], actions: [] })
    await send('POST', `/crew/triggers/${json.trigger.id}/test`)
    const call = handled[0]!
    expect(verifyGeneric(call.raw!, call.headers, json.secret, 1_762_680_000_000)).toMatchObject({ ok: true, eventType: 'test', deliveryId: 'delivery-1' })
    expect(JSON.parse(call.raw!.toString())).toEqual({ message: 'Test event from Crew', id: 'delivery-1' })
    const gh = await create({ events: [], actions: [] })
    await send('POST', `/crew/triggers/${gh.json.trigger.id}/test`)
    expect(JSON.parse(handled[1]!.raw!.toString())).toMatchObject({ action: 'opened' })
    expect(handled[1]!.headers.get('x-github-event')).toBe('issues')
  })
})

describe('errors and wiring', () => {
  it('answers 400 bad_id and 404 not_found', async () => {
    expect(await (await send('DELETE', '/crew/triggers/nope')).json()).toEqual({ error: 'bad_id' })
    expect(await (await send('DELETE', `/crew/triggers/${'f'.repeat(32)}`)).json()).toEqual({ error: 'not_found' })
  })

  it('answers 503 hermes_offline when triggers are not wired', async () => {
    const bare = createApp(base)
    const res = await bare.request('/crew/bots/crew-test/triggers', { headers })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'triggers_unavailable' })
  })
})

describe('a failed save keeps the replies truthful (memory is authoritative)', () => {
  const unwritable = () => chmod(dir, 0o500)
  const noSecretIn = (text: string, secret: string) => expect(text + lines.join('\n')).not.toContain(secret)

  it('create answers 201 with saved:false and the live trigger', async () => {
    await unwritable()
    const { res, json } = await create()
    expect(res.status).toBe(201)
    expect(json).toMatchObject({ saved: false, secret: expect.stringMatching(/^[0-9a-f]{64}$/) })
    expect(store.get(json.trigger.id)?.secret).toBe(json.secret)
    expect(lines.map(l => JSON.parse(l)).some(l => l.level === 'error' && l.msg === 'trigger store write failed')).toBe(true)
    noSecretIn('', json.secret)
  })

  it('PATCH answers the changed trigger with saved:false and no secret', async () => {
    const { json } = await create()
    await unwritable()
    const res = await send('PATCH', `/crew/triggers/${json.trigger.id}`, { name: 'Renamed', enabled: false })
    expect(res.status).toBe(200)
    const text = await res.text()
    expect(JSON.parse(text)).toMatchObject({ name: 'Renamed', enabled: false, saved: false })
    expect(store.get(json.trigger.id)).toMatchObject({ name: 'Renamed', enabled: false })
    noSecretIn(text, json.secret)
  })

  it('a new secret is returned with saved:false and is the one in effect', async () => {
    const { json } = await create()
    await unwritable()
    const res = await send('POST', `/crew/triggers/${json.trigger.id}/secret`)
    expect(res.status).toBe(200)
    const body = (await res.json()) as { secret: string; saved: boolean }
    expect(body.saved).toBe(false)
    expect(store.get(json.trigger.id)?.secret).toBe(body.secret)
    noSecretIn('', json.secret)
  })

  it('DELETE answers 200 saved:false and the trigger is gone from memory', async () => {
    const { json } = await create()
    await unwritable()
    const res = await send('DELETE', `/crew/triggers/${json.trigger.id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ saved: false })
    expect(store.get(json.trigger.id)).toBeUndefined()
  })

  it('successful writes keep saved out of the replies', async () => {
    const { json } = await create()
    expect(json).not.toHaveProperty('saved')
    expect((await send('DELETE', `/crew/triggers/${json.trigger.id}`)).status).toBe(204)
  })
})

describe('send test event details', () => {
  it('logs one error line and answers 500 when the handler throws', async () => {
    const { json } = await create()
    const throwing = createApp({ ...base, triggers: { store, hooks: { handle: async () => { throw new Error(`boom ${json.secret}`) } }, routines: { list: async () => [] } as never, hookUrl: id => id, now: () => 1, newTriggerId: () => 'x', newSecret: () => 'y', newId: () => 'z' } })
    const res = await throwing.request(`/crew/triggers/${json.trigger.id}/test`, { method: 'POST', headers })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'internal' })
    const out = lines.map(l => JSON.parse(l)).filter(l => l.msg === 'hook event')
    expect(out).toEqual([expect.objectContaining({ trigger: json.trigger.id.slice(0, 8), status: 500, outcome: 'error' })])
    expect(lines.join('\n')).not.toContain(json.secret)
  })

  it('goes through the real hook handler: passes verify and its own filter, and counts toward the limits', async () => {
    const limiter = createLimiter(DEFAULT_LIMITS)
    const starts: { eventType: string; action: string | null }[] = []
    const runner = {
      start: async (t: Trigger, input: EventInput): Promise<StartResult> => {
        const got = limiter.tryAcquire(t.id, 1_762_680_000_000)
        const event = { id: input.eventId, at: input.at, deliveryId: input.deliveryId, eventType: input.eventType, action: input.action, outcome: got.ok ? 'started' as const : 'too_many' as const, jobId: null, runId: null, endedAt: null, detail: null }
        if (!got.ok) return { ok: false, status: 429, error: 'too_many_events', event }
        starts.push({ eventType: input.eventType, action: input.action })
        await store.logEvent(t.id, event, input.deliveryId)
        return { ok: true, event }
      }
    }
    let n = 0
    const real = createApp({ ...base, triggers: { store, hooks: createHookHandler({ store, runner, now: () => 1_762_680_000_000, newId: () => `id${++n}` }), routines: { list: async () => [{ id: 'rt1' }] } as never, hookUrl: id => id, now: () => 1_762_680_000_000, newTriggerId: () => 'e'.repeat(32), newSecret: () => 's'.repeat(64), newId: () => `d${++n}` } })
    const make = await real.request('/crew/bots/crew-test/triggers', { method: 'POST', headers, body: JSON.stringify({ routineId: 'rt1', name: 'T', source: 'github', events: ['pull_request'], actions: ['reopened'] }) })
    const id = ((await make.json()) as { trigger: { id: string } }).trigger.id
    const test = () => real.request(`/crew/triggers/${id}/test`, { method: 'POST', headers })
    expect(await (await test()).json()).toMatchObject({ httpStatus: 202 })
    expect(await (await test()).json()).toMatchObject({ httpStatus: 202 })
    expect(await (await test()).json()).toMatchObject({ httpStatus: 429, event: { outcome: 'too_many' } })
    expect(starts).toEqual([{ eventType: 'pull_request', action: 'reopened' }, { eventType: 'pull_request', action: 'reopened' }])
  })
})

describe('sample events are never replays of each other', () => {
  it('differs in body and signature per delivery id', async () => {
    const t: Trigger = { id: 'a'.repeat(32), bot: 'b', routineId: 'r', name: 'n', source: 'github', events: [], actions: [], enabled: true, secret: 's', createdAt: 1 }
    const one = sampleEvent(t, 1_000, 'd1')
    const two = sampleEvent(t, 1_000, 'd2')
    expect(one.headers.get('x-hub-signature-256')).not.toBe(two.headers.get('x-hub-signature-256'))
    const g = sampleEvent({ ...t, source: 'generic' }, 1_000, 'd1')
    const g2 = sampleEvent({ ...t, source: 'generic' }, 1_000, 'd2')
    expect(g.headers.get('x-crew-signature')).not.toBe(g2.headers.get('x-crew-signature'))
  })
})
