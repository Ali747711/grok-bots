import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setLogSink } from '../src/log.js'
import { createHookHandler, passesFilter, type HookHandler } from '../src/triggers/hook-handler.js'
import type { EventInput, StartResult } from '../src/triggers/runner.js'
import { TriggerStore } from '../src/triggers/store.js'
import type { Trigger, TriggerEvent } from '../src/triggers/types.js'
import { signGeneric, signGithub } from '../src/triggers/verify.js'

const TID = 'c'.repeat(32)
const SECRET = 'topsecretvalue-123'
const NOW = 1_762_680_000_000
const trigger = (over: Partial<Trigger> = {}): Trigger => ({ id: TID, bot: 'crew-test', routineId: 'rt1', name: 'T', source: 'github', events: [], actions: [], enabled: true, secret: SECRET, createdAt: 1, ...over })

let dir: string
let store: TriggerStore
let lines: string[]
let restoreLog: () => void
let starts: { trigger: Trigger; input: EventInput }[]
let startReply: (() => Promise<StartResult>) | null
let handler: HookHandler
let n: number

const body = Buffer.from(JSON.stringify({ action: 'opened', issue: { number: 1 } }))
const gh = (over: Record<string, string | undefined> = {}, raw = body) => {
  const headers = new Headers({ 'x-github-event': 'issues', 'x-github-delivery': 'd1', 'x-hub-signature-256': signGithub(raw, SECRET), 'content-type': 'application/json' })
  for (const [k, v] of Object.entries(over)) v === undefined ? headers.delete(k) : headers.set(k, v)
  return headers
}
let clock: number
const events = () => store.events(TID)

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hook-'))
  store = await TriggerStore.load(join(dir, 'triggers.json'))
  await store.add(trigger())
  lines = []
  restoreLog = setLogSink(l => { lines.push(l) })
  starts = []
  startReply = null
  n = 0
  clock = NOW
  const runner = {
    start: async (t: Trigger, input: EventInput): Promise<StartResult> => {
      starts.push({ trigger: t, input })
      if (startReply) return startReply()
      await new Promise(resolve => setTimeout(resolve, 5))
      const event: TriggerEvent = { id: input.eventId, at: input.at, deliveryId: input.deliveryId, eventType: input.eventType, action: input.action, outcome: 'started', jobId: 'j', runId: null, endedAt: null, detail: null }
      await store.logEvent(t.id, event, input.deliveryId)
      return { ok: true, event }
    }
  }
  handler = createHookHandler({ store, runner, now: () => clock, newId: () => `id${++n}` })
})
afterEach(async () => {
  restoreLog()
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

const logged = () => lines.map(l => JSON.parse(l) as Record<string, unknown>)

describe('hook handler', () => {
  it('knows its triggers', () => {
    expect(handler.known(TID)).toBe(true)
    expect(handler.known('e'.repeat(32))).toBe(false)
  })

  it('answers 404 for an unknown trigger and logs no id', async () => {
    const r = await handler.handle('d'.repeat(32), body, gh())
    expect(r).toMatchObject({ status: 404, body: { error: 'not_found' } })
    expect(lines.join('\n')).not.toContain('d'.repeat(8))
    expect(logged().filter(l => l.msg === 'hook for unknown trigger')).toHaveLength(1)
    expect((await handler.handle('../etc', body, gh())).status).toBe(404)
  })

  it('answers 403 for a trigger that is off, before checking the signature, and logs it', async () => {
    await store.update(TID, { enabled: false })
    const r = await handler.handle(TID, body, gh({ 'x-hub-signature-256': 'sha256=bad' }))
    expect(r).toMatchObject({ status: 403, body: { error: 'trigger_off' } })
    expect(events()[0]).toMatchObject({ outcome: 'trigger_off' })
    expect(logged().some(l => l.msg === 'hook event' && l.status === 403 && l.outcome === 'trigger_off')).toBe(true)
  })

  it('answers 401 for a bad signature, logs the reason and does not record the delivery', async () => {
    const r = await handler.handle(TID, body, gh({ 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }))
    expect(r).toMatchObject({ status: 401, body: { error: 'bad_signature' } })
    expect(events()[0]).toMatchObject({ outcome: 'bad_signature', detail: 'signature does not match', deliveryId: null })
    expect(store.seenDelivery(TID, 'd1')).toBe(false)
    expect((await handler.handle(TID, body, gh())).status).toBe(202)
    clock += 60_000
    expect((await handler.handle(TID, body, gh({ 'x-hub-signature-256': undefined }))).status).toBe(401)
    expect(events()[0]?.detail).toBe('missing signature')
  })

  it('answers pong for a GitHub ping without starting a run', async () => {
    const r = await handler.handle(TID, body, gh({ 'x-github-event': 'ping' }))
    expect(r).toMatchObject({ status: 200, body: { status: 'pong' } })
    expect(starts).toEqual([])
    expect(events()[0]).toMatchObject({ outcome: 'ignored', detail: 'GitHub ping' })
    expect(store.seenDelivery(TID, 'd1')).toBe(true)
  })

  it('ignores an event or action outside the filter and records the delivery', async () => {
    await store.update(TID, { events: ['issues'] })
    let r = await handler.handle(TID, body, gh({ 'x-github-event': 'push', 'x-github-delivery': 'p1' }))
    expect(r).toMatchObject({ status: 200, body: { status: 'ignored' } })
    expect(events()[0]).toMatchObject({ outcome: 'ignored', detail: 'not in the event filter', eventType: 'push' })
    expect(store.seenDelivery(TID, 'p1')).toBe(true)
    await store.update(TID, { actions: ['closed'] })
    const second = Buffer.from(JSON.stringify({ action: 'opened', issue: { number: 2 } }))
    r = await handler.handle(TID, second, gh({ 'x-github-delivery': 'p2' }, second))
    expect(events()[0]).toMatchObject({ outcome: 'ignored', detail: 'action not in the filter', action: 'opened' })
    expect(starts).toEqual([])
    await store.update(TID, { events: [], actions: ['opened'] })
    const push = Buffer.from('{"ref":"main"}')
    expect((await handler.handle(TID, push, gh({ 'x-github-event': 'push', 'x-github-delivery': 'p3', 'x-hub-signature-256': signGithub(push, SECRET) }))).status).toBe(202)
  })

  it('passesFilter treats empty lists as everything and matches exactly (R5)', () => {
    expect(passesFilter(trigger(), 'x', 'y')).toEqual({ ok: true })
    expect(passesFilter(trigger({ events: ['issues'] }), 'issues', null)).toEqual({ ok: true })
    expect(passesFilter(trigger({ actions: ['opened'] }), 'push', null)).toEqual({ ok: true })
    expect(passesFilter(trigger({ source: 'generic', events: ['build.done'] }), 'Build.Done', null)).toEqual({ ok: false, detail: 'not in the event filter' })
    expect(passesFilter(trigger({ actions: ['opened'] }), 'issues', 'Opened')).toEqual({ ok: false, detail: 'action not in the filter' })
  })

  it('records unverified outcomes once per trigger per minute and counts the rest', async () => {
    const bad = gh({ 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) })
    for (let i = 0; i < 20; i++) expect((await handler.handle(TID, body, bad)).status).toBe(401)
    expect(events().filter(e => e.outcome === 'bad_signature')).toHaveLength(1)
    expect(logged().filter(l => l.msg === 'hook event')).toHaveLength(1)
    clock += 60_000
    expect((await handler.handle(TID, body, bad)).status).toBe(401)
    expect(events()[0]).toMatchObject({ outcome: 'bad_signature', detail: 'signature does not match +19 more in the last minute' })
    expect(logged().filter(l => l.msg === 'hook event')).toHaveLength(2)
    expect(logged().filter(l => l.msg === 'hook event')[1]).toMatchObject({ more: 19 })
    // trigger_off and too_large share the same per-trigger throttle
    await store.update(TID, { enabled: false })
    await handler.handle(TID, body, bad)
    await handler.handle(TID, null, bad)
    expect(events()).toHaveLength(2)
    clock += 60_000
    await handler.handle(TID, null, bad)
    expect(events()[0]).toMatchObject({ outcome: 'too_large', detail: '+2 more in the last minute' })
  })

  it('throttles unknown-id lines to one per minute in total, with a count, oversized bodies included', async () => {
    for (let i = 0; i < 10; i++) await handler.handle(`${i}`.repeat(32), body, gh())
    for (let i = 0; i < 5; i++) expect((await handler.handle('f'.repeat(32), null, gh())).status).toBe(413)
    expect(logged().filter(l => l.msg === 'hook for unknown trigger')).toHaveLength(1)
    clock += 60_000
    await handler.handle('9'.repeat(32), body, gh())
    const unknown = logged().filter(l => l.msg === 'hook for unknown trigger')
    expect(unknown).toHaveLength(2)
    expect(unknown[1]).toMatchObject({ more: 14 })
    expect(lines.join('\n')).not.toContain('99999999')
  })

  it('releases the delivery reservation when the runner throws', async () => {
    startReply = async () => { throw new Error('boom') }
    await expect(handler.handle(TID, body, gh())).rejects.toThrow('boom')
    startReply = null
    expect((await handler.handle(TID, body, gh())).status).toBe(202)
  })

  it('accepts and passes the parsed event, raw text and delivery to the runner', async () => {
    const r = await handler.handle(TID, body, gh())
    expect(r).toMatchObject({ status: 202, body: { status: 'accepted', event: 'issues', eventId: 'id1' } })
    expect(starts[0]?.input).toMatchObject({ eventId: 'id1', at: NOW, deliveryId: 'd1', eventType: 'issues', action: 'opened', rawText: body.toString('utf8'), payload: { kind: 'json' } })
    expect(store.seenDelivery(TID, 'd1')).toBe(true)
  })

  it('treats a replay of the same body and signature as a duplicate whatever its delivery id says', async () => {
    expect((await handler.handle(TID, body, gh())).status).toBe(202)
    for (const delivery of ['forged-1', undefined]) {
      expect(await handler.handle(TID, body, gh({ 'x-github-delivery': delivery }))).toMatchObject({ status: 200, body: { status: 'duplicate' } })
    }
    expect(starts).toHaveLength(1)
    // a deliberately ignored event is remembered by signature too
    await store.update(TID, { events: ['issues'] })
    const push = Buffer.from('{"ref":"main"}')
    const pushHeaders = (d?: string) => gh({ 'x-github-event': 'push', 'x-github-delivery': d, 'x-hub-signature-256': signGithub(push, SECRET) }, push)
    expect((await handler.handle(TID, push, pushHeaders('a'))).body).toEqual({ status: 'ignored' })
    expect((await handler.handle(TID, push, pushHeaders(undefined))).body).toEqual({ status: 'duplicate' })
    // refusals do not remember the signature
    await store.update(TID, { events: [] })
    startReply = async () => ({ ok: false, status: 503, error: 'hermes_offline', event: { id: 'x', at: NOW, deliveryId: null, eventType: 'e', action: null, outcome: 'failed', jobId: null, runId: null, endedAt: null, detail: null } })
    const fresh = Buffer.from('{"fresh":1}')
    const freshHeaders = () => gh({ 'x-hub-signature-256': signGithub(fresh, SECRET), 'x-github-delivery': undefined }, fresh)
    expect((await handler.handle(TID, fresh, freshHeaders())).status).toBe(503)
    startReply = null
    expect((await handler.handle(TID, fresh, freshHeaders())).status).toBe(202)
  })

  it('answers duplicate for a delivery seen before', async () => {
    await handler.handle(TID, body, gh())
    const r = await handler.handle(TID, body, gh())
    expect(r).toMatchObject({ status: 200, body: { status: 'duplicate' } })
    expect(starts).toHaveLength(1)
    expect(events()[0]).toMatchObject({ outcome: 'duplicate' })
  })

  it('runs once for two concurrent requests with the same delivery id', async () => {
    const results = await Promise.all([handler.handle(TID, body, gh()), handler.handle(TID, body, gh())])
    expect(results.map(r => r.status).sort()).toEqual([200, 202])
    expect(starts).toHaveLength(1)
  })

  it('logs too_large for a known trigger', async () => {
    const r = await handler.handle(TID, null, gh())
    expect(r).toMatchObject({ status: 413, body: { error: 'too_large' } })
    expect(events()[0]).toMatchObject({ outcome: 'too_large' })
    expect((await handler.handle('e'.repeat(32), null, gh())).status).toBe(413)
  })

  it('maps runner refusals to their status and leaves the delivery unrecorded', async () => {
    const refusal = (status: 429 | 503, error: 'too_many_events' | 'hermes_offline'): StartResult => ({
      ok: false, status, error, event: { id: 'x', at: NOW, deliveryId: 'd1', eventType: 'issues', action: null, outcome: status === 429 ? 'too_many' : 'failed', jobId: null, runId: null, endedAt: null, detail: null }
    })
    startReply = async () => refusal(503, 'hermes_offline')
    expect(await handler.handle(TID, body, gh())).toMatchObject({ status: 503, body: { error: 'hermes_offline' } })
    startReply = async () => refusal(429, 'too_many_events')
    expect(await handler.handle(TID, body, gh())).toMatchObject({ status: 429, body: { error: 'too_many_events' } })
    expect(store.seenDelivery(TID, 'd1')).toBe(false)
    startReply = null
    expect((await handler.handle(TID, body, gh())).status).toBe(202)
  })

  it('checks the Generic timestamp', async () => {
    await store.remove(TID)
    await store.add(trigger({ source: 'generic' }))
    const ts = String(NOW / 1000)
    const gen = (stamp: string, sig = signGeneric(body, SECRET, stamp)) => new Headers({ 'x-crew-timestamp': stamp, 'x-crew-signature': sig, 'x-crew-event': 'build.done', 'x-crew-delivery': `g${stamp}` })
    expect(await handler.handle(TID, body, gen(ts))).toMatchObject({ status: 202, body: { event: 'build.done' } })
    const old = String(NOW / 1000 - 301)
    expect(await handler.handle(TID, body, gen(old))).toMatchObject({ status: 401 })
    expect(events()[0]?.detail).toBe('timestamp too old or too new')
    expect(starts[0]?.input.action).toBeNull()
  })

  it('never puts the secret in a body or a log line', async () => {
    const results = [
      await handler.handle(TID, body, gh()),
      await handler.handle(TID, body, gh({ 'x-hub-signature-256': 'sha256=' + '1'.repeat(64) })),
      await handler.handle(TID, null, gh())
    ]
    expect(JSON.stringify(results)).not.toContain(SECRET)
    expect(lines.join('\n')).not.toContain(SECRET)
    expect(lines.join('\n')).not.toContain(TID)
    expect(JSON.stringify(store.events(TID))).not.toContain(SECRET)
  })
})
