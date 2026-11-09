import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HermesRestError } from '../src/hermes/errors.js'
import type { HermesRest, RestMethod, RestOptions } from '../src/hermes/rest-client.js'
import { setLogSink } from '../src/log.js'
import { createLimiter, DEFAULT_LIMITS } from '../src/triggers/limits.js'
import { createTriggerRunner, type EventInput, type TriggerRunner } from '../src/triggers/runner.js'
import { TriggerStore } from '../src/triggers/store.js'
import type { Trigger, TriggerEvent } from '../src/triggers/types.js'

interface Call { method: string; path: string; query?: Record<string, string>; body?: unknown; timeoutMs?: number }

const TID = 'a'.repeat(32)
const NOW = Date.parse('2026-11-09T09:05:57Z')
const trigger = (over: Partial<Trigger> = {}): Trigger => ({ id: TID, bot: 'crew-test', routineId: 'rt1', name: 'Issues', source: 'github', events: [], actions: [], enabled: true, secret: 's', createdAt: 1, ...over })
const routine = (extra: Record<string, unknown> = {}) => ({
  id: 'rt1', name: '[bot:crew-test] Triage', prompt: 'Triage it', profile: 'crew-test', enabled: true, state: 'scheduled', deliver: 'bot-chat', model: 'm', provider: null, timezone: 'Asia/Seoul', ...extra
})
const input = (n: number, over: Partial<EventInput> = {}): EventInput => ({ eventId: `ev${n}`, at: NOW, deliveryId: `d${n}`, eventType: 'issues', action: 'opened', payload: { kind: 'json', value: { action: 'opened' } }, ...over })

let dir: string
let store: TriggerStore
let calls: Call[]
let handler: (call: Call) => unknown
let runner: TriggerRunner
let lines: string[]
let restoreLog: () => void
let seq: number
let oneShots: Map<string, Record<string, unknown>>

const rest: HermesRest = {
  request: async <T>(method: RestMethod, path: string, opts: RestOptions = {}): Promise<T> => {
    const call: Call = { method, path, ...(opts.query ? { query: opts.query } : {}), ...(opts.body === undefined ? {} : { body: opts.body }), ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }) }
    calls.push(call)
    return handler(call) as T
  }
}

const finishedJob = (extra: Record<string, unknown> = {}) => ({ id: 'os1', state: 'completed', enabled: false, last_run_at: '2026-11-09T09:06:00+00:00', last_status: 'ok', ...extra })
/** Routine rt1 plus one-shots os1, os2, …; `state` decides what a poll of a one-shot sees. */
const happy = (oneShotState: () => unknown = () => finishedJob()) => (call: Call): unknown => {
  if (call.method === 'GET' && call.path === '/api/cron/jobs/rt1') return routine()
  if (call.method === 'POST' && call.path === '/api/cron/jobs') {
    const id = `os${++seq}`
    oneShots.set(id, call.body as Record<string, unknown>)
    return { id }
  }
  if (call.method === 'POST' && call.path.endsWith('/trigger')) return { ok: true }
  if (call.method === 'GET' && call.path.endsWith('/runs')) return { runs: [{ id: 'sess1', source: 'cron', title: 'x', started_at: 1_794_000_000, ended_at: 1_794_000_030, is_active: false }] }
  if (call.method === 'GET' && /^\/api\/cron\/jobs\/os\d+$/.test(call.path)) return oneShotState()
  if (call.method === 'DELETE') return { ok: true }
  throw new Error(`unscripted ${call.method} ${call.path}`)
}

beforeEach(async () => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  dir = await mkdtemp(join(tmpdir(), 'runner-'))
  store = await TriggerStore.load(join(dir, 'triggers.json'))
  await store.add(trigger())
  calls = []
  seq = 0
  oneShots = new Map()
  lines = []
  restoreLog = setLogSink(l => { lines.push(l) })
  handler = happy()
  runner = createTriggerRunner({ rest, store, limiter: createLimiter(DEFAULT_LIMITS), now: () => Date.now() })
})
afterEach(async () => {
  runner.stop()
  restoreLog()
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 })
})

const poll = (ms = 5_000) => vi.advanceTimersByTimeAsync(ms)
/** Store writes hit the real disk, which fake timers do not drive: wait for the effect itself. */
const until = (check: () => void) => vi.waitFor(check, { timeout: 3_000, interval: 5 })
const events = () => store.events(TID)

describe('start', () => {
  it('creates the one-shot with the tag name, ISO schedule and only the set fields, then fires it', async () => {
    const r = await runner.start(trigger(), input(1))
    expect(r).toMatchObject({ ok: true, event: { outcome: 'started', jobId: 'os1', id: 'ev1' } })
    const body = oneShots.get('os1')!
    expect(body).toMatchObject({ name: `[trigger:${TID}] Triage · issues`, schedule: '2026-11-09T09:05:57+00:00', deliver: 'bot-chat', model: 'm', timezone: 'Asia/Seoul' })
    expect(body.prompt).toEqual(expect.stringContaining('Triage it'))
    expect(Object.keys(body)).not.toContain('provider')
    const fire = calls.find(c => c.path.endsWith('/trigger'))!
    expect(fire).toMatchObject({ method: 'POST', path: '/api/cron/jobs/os1/trigger', query: { profile: 'crew-test' }, timeoutMs: 0 })
    expect(events()[0]).toMatchObject({ outcome: 'started', jobId: 'os1' })
    expect(store.seenDelivery(TID, 'd1')).toBe(true)
  })

  it('fires a trigger-only routine and refuses a normally paused one with 409 and no create', async () => {
    const base = happy()
    handler = call => (call.method === 'GET' && call.path === '/api/cron/jobs/rt1' ? routine({ enabled: false, state: 'paused', paused_reason: 'crew:trigger-only' }) : base(call))
    expect((await runner.start(trigger(), input(1))).ok).toBe(true)
    handler = call => (call.method === 'GET' && call.path === '/api/cron/jobs/rt1' ? routine({ enabled: false, state: 'paused', paused_reason: 'vacation' }) : base(call))
    calls = []
    const r = await runner.start(trigger(), input(2))
    expect(r).toMatchObject({ ok: false, status: 409, error: 'routine_paused', event: { outcome: 'routine_paused' } })
    expect(calls.filter(c => c.method === 'POST')).toEqual([])
    expect(events()[0]).toMatchObject({ id: 'ev2', outcome: 'routine_paused' })
  })

  it('maps a deleted routine to 410, Hermes offline to 503 and a refusal to 502, freeing the slot', async () => {
    const base = happy()
    for (let i = 0; i < 3; i++) {
      handler = call => { if (call.method === 'GET' && call.path === '/api/cron/jobs/rt1') throw new HermesRestError(404, 'gone'); return base(call) }
      expect(await runner.start(trigger(), input(i * 10 + 1))).toMatchObject({ ok: false, status: 410, error: 'routine_deleted', event: { outcome: 'failed', detail: 'routine deleted' } })
      handler = call => { if (call.method === 'GET' && call.path === '/api/cron/jobs/rt1') throw new Error('fetch failed'); return base(call) }
      expect(await runner.start(trigger(), input(i * 10 + 2))).toMatchObject({ ok: false, status: 503, error: 'hermes_offline', event: { detail: 'Hermes offline' } })
      handler = call => { if (call.method === 'POST' && call.path === '/api/cron/jobs') throw new HermesRestError(400, 'Blocked: prompt matches a threat pattern'); return base(call) }
      expect(await runner.start(trigger(), input(i * 10 + 3))).toMatchObject({ ok: false, status: 502, error: 'hermes_refused', event: { detail: 'Blocked: prompt matches a threat pattern' } })
    }
    handler = base
    expect((await runner.start(trigger(), input(99))).ok).toBe(true)
    expect(store.seenDelivery(TID, 'd1')).toBe(false)
  })

  it('maps a reply without a job id to 502, and another profile owning the routine to 410', async () => {
    const base = happy()
    handler = call => (call.method === 'POST' && call.path === '/api/cron/jobs' ? {} : base(call))
    expect(await runner.start(trigger(), input(1))).toMatchObject({ ok: false, status: 502, event: { detail: 'unexpected Hermes reply' } })
    handler = call => (call.method === 'GET' && call.path === '/api/cron/jobs/rt1' ? routine({ profile: 'someone-else' }) : base(call))
    expect(await runner.start(trigger(), input(2))).toMatchObject({ ok: false, status: 410 })
  })

  it('answers 429 too many without calling Hermes', async () => {
    handler = happy(() => ({ id: 'os', state: 'scheduled', enabled: true }))
    await runner.start(trigger(), input(1))
    await runner.start(trigger(), input(2))
    calls = []
    const r = await runner.start(trigger(), input(3))
    expect(r).toMatchObject({ ok: false, status: 429, error: 'too_many_events', event: { outcome: 'too_many', detail: '2 runs already running' } })
    expect(calls).toEqual([])
    expect(events()[0]).toMatchObject({ id: 'ev3', outcome: 'too_many' })
  })

  it('treats a 409 from /trigger as normal', async () => {
    const base = happy()
    handler = call => { if (call.path.endsWith('/trigger')) throw new HermesRestError(409, 'already running'); return base(call) }
    expect((await runner.start(trigger(), input(1))).ok).toBe(true)
    await poll(0)
    expect(lines.map(l => JSON.parse(l)).filter(l => l.level !== 'info' || String(l.msg).includes('fire'))).toEqual([])
  })
})

describe('polling', () => {
  it('records finished with the run session, then deletes the one-shot', async () => {
    let seenAtDelete: string | undefined
    const base = happy()
    handler = call => { if (call.method === 'DELETE') seenAtDelete = events()[0]?.outcome; return base(call) }
    await runner.start(trigger(), input(1))
    await poll()
    await until(() => expect(calls.at(-1)?.method).toBe('DELETE'))
    expect(events()[0]).toMatchObject({ outcome: 'finished', runId: 'sess1', detail: null })
    expect(events()[0]?.endedAt).toBe(1_794_000_030_000)
    expect(seenAtDelete).toBe('finished')
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/cron/jobs/os1', query: { profile: 'crew-test' } })
    expect(calls.map(c => c.path)).toContain('/api/cron/jobs/os1/runs')
    await poll(30_000)
    expect(calls.filter(c => c.method === 'DELETE')).toHaveLength(1)
  })

  it('records blocked for a Blocked: error and failed for other errors', async () => {
    handler = happy(() => finishedJob({ last_status: 'error', last_error: 'Blocked: prompt matches a threat pattern', state: 'error' }))
    await runner.start(trigger(), input(1))
    await poll()
    await until(() => expect(calls.some(c => c.method === 'DELETE')).toBe(true))
    expect(events()[0]).toMatchObject({ outcome: 'blocked', detail: 'Blocked: prompt matches a threat pattern' })
    handler = happy(() => finishedJob({ last_status: 'error', last_error: 'model error', state: 'error' }))
    await runner.start(trigger(), input(2))
    await poll()
    await until(() => expect(events()[0]).toMatchObject({ id: 'ev2', outcome: 'failed', detail: 'model error' }))
  })

  it('frees the in-flight slot only when the outcome is recorded', async () => {
    let done = false
    handler = happy(() => (done ? finishedJob() : { id: 'os', state: 'scheduled', enabled: true }))
    await runner.start(trigger(), input(1))
    await runner.start(trigger(), input(2))
    await poll(15_000)
    expect((await runner.start(trigger(), input(3))).ok).toBe(false)
    done = true
    await poll()
    await until(() => expect(events().filter(e => e.outcome === 'finished')).toHaveLength(2))
    expect((await runner.start(trigger(), input(4))).ok).toBe(true)
    expect(events().filter(e => e.outcome === 'finished')).toHaveLength(2)
  })

  it('gives up after 30 minutes without deleting the job', async () => {
    handler = happy(() => ({ id: 'os1', state: 'scheduled', enabled: true }))
    await runner.start(trigger(), input(1))
    await poll(30 * 60_000 + 5_000)
    await until(() => expect(events()[0]).toMatchObject({ outcome: 'failed', detail: 'no result after 30 minutes' }))
    expect(calls.filter(c => c.method === 'DELETE')).toEqual([])
    calls = []
    await poll(60_000)
    expect(calls).toEqual([])
  })

  it('keeps polling through a failing read', async () => {
    let n = 0
    handler = happy(() => { if (++n < 3) throw new Error('timeout'); return finishedJob() })
    await runner.start(trigger(), input(1))
    await poll(15_000)
    await until(() => expect(events()[0]?.outcome).toBe('finished'))
  })

  const sessions = (rows: { id: string; title: string; started_at: number }[]) => {
    const base = happy(() => { throw new HermesRestError(404, 'Job not found') })
    handler = call => (call.method === 'GET' && call.path === '/api/sessions' ? { sessions: rows } : base(call))
  }
  const title = `[trigger:${TID}] Triage · issues · Nov 09 18:06`

  it('recovers a vanished job from exactly one matching session', async () => {
    sessions([{ id: 's-match', title, started_at: NOW / 1000 + 3 }, { id: 'other', title: '[bot:crew-test] Something', started_at: NOW / 1000 + 3 }, { id: 'old', title, started_at: NOW / 1000 - 3600 }])
    await runner.start(trigger(), input(1))
    await poll()
    await until(() => expect(events()[0]).toMatchObject({ outcome: 'finished', runId: 's-match', detail: null }))
    expect(calls.find(c => c.path === '/api/sessions')).toMatchObject({ query: { source: 'cron', profile: 'crew-test', limit: '50' } })
    expect(calls.filter(c => c.method === 'DELETE')).toEqual([])
  })

  it('marks a vanished job lost on restart when no session or several match', async () => {
    sessions([])
    await runner.start(trigger(), input(1))
    await poll()
    await until(() => expect(events()[0]).toMatchObject({ outcome: 'failed', detail: 'lost on restart', runId: null }))
    sessions([{ id: 'a', title, started_at: NOW / 1000 + 3 }, { id: 'b', title, started_at: NOW / 1000 + 4 }])
    await runner.start(trigger(), input(2))
    await poll()
    await until(() => expect(events()[0]).toMatchObject({ id: 'ev2', outcome: 'failed', detail: 'lost on restart' }))
  })

  it('still releases the slot and deletes the job when the trigger was deleted meanwhile', async () => {
    await runner.start(trigger(), input(1))
    await store.remove(TID)
    await poll()
    await until(() => expect(calls.at(-1)).toMatchObject({ method: 'DELETE', path: '/api/cron/jobs/os1' }))
    await store.add(trigger())
    expect((await runner.start(trigger(), input(2))).ok).toBe(true)
    expect((await runner.start(trigger(), input(3))).ok).toBe(true)
  })

  it('survives a store write failure without crashing', async () => {
    const dir0 = dir
    await runner.start(trigger(), input(1))
    const { chmod } = await import('node:fs/promises')
    await chmod(dir0, 0o500)
    try {
      await poll()
      await until(() => expect(lines.map(l => JSON.parse(l)).some(l => l.msg === 'trigger store write failed')).toBe(true))
      await until(() => expect(calls.some(c => c.method === 'DELETE')).toBe(true))
    } finally {
      await chmod(dir0, 0o700)
    }
    expect(events()[0]?.outcome).toBe('finished')
  })
})

describe('review fixes', () => {
  it('copies no_agent when true, with the script', async () => {
    const base = happy()
    handler = call => (call.method === 'GET' && call.path === '/api/cron/jobs/rt1' ? routine({ no_agent: true, script: 'run.sh' }) : base(call))
    await runner.start(trigger(), input(1))
    expect(oneShots.get('os1')).toMatchObject({ no_agent: true, script: 'run.sh' })
    handler = call => (call.method === 'GET' && call.path === '/api/cron/jobs/rt1' ? routine({ no_agent: false }) : base(call))
    await runner.start(trigger(), input(2))
    expect(Object.keys(oneShots.get('os2')!)).not.toContain('no_agent')
  })

  it('does not record a session another event already uses (recovery)', async () => {
    const title = `[trigger:${TID}] Triage · issues · Nov 09 18:06`
    await store.logEvent(TID, { id: 'prev', at: NOW - 1000, deliveryId: null, eventType: 'issues', action: null, outcome: 'finished', jobId: 'old', runId: 's-used', endedAt: null, detail: null })
    const base = happy(() => { throw new HermesRestError(404, 'Job not found') })
    handler = call => (call.method === 'GET' && call.path === '/api/sessions' ? { sessions: [{ id: 's-used', title, started_at: NOW / 1000 + 3 }] } : base(call))
    await runner.start(trigger(), input(1))
    await poll()
    await until(() => expect(events()[0]).toMatchObject({ id: 'ev1', outcome: 'failed', detail: 'lost on restart' }))
  })

  it('keeps the hourly stamp after an ambiguous create failure but gives it back after an HTTP error', async () => {
    const base = happy()
    handler = call => { if (call.method === 'POST' && call.path === '/api/cron/jobs') throw new HermesRestError(500, 'boom'); return base(call) }
    for (let i = 0; i < 12; i++) expect(await runner.start(trigger(), input(i))).toMatchObject({ ok: false, status: 503 })
    handler = call => { if (call.method === 'POST' && call.path === '/api/cron/jobs') throw new Error('socket hang up'); return base(call) }
    for (let i = 20; i < 30; i++) expect(await runner.start(trigger(), input(i))).toMatchObject({ ok: false, status: 503 })
    handler = base
    expect(await runner.start(trigger(), input(99))).toMatchObject({ ok: false, status: 429, event: { detail: '10 runs in the last hour' } })
  })
})

describe('resume', () => {
  it('resumes started events after a restart and counts them against the limits', async () => {
    const started = (n: number): TriggerEvent => ({ id: `old${n}`, at: NOW - 60_000, deliveryId: null, eventType: 'issues', action: null, outcome: 'started', jobId: `os${n}`, runId: null, endedAt: null, detail: null })
    await store.logEvent(TID, started(7))
    await store.logEvent(TID, started(8))
    await store.logEvent(TID, { ...started(9), id: 'fin', outcome: 'finished', runId: 'sx' })
    let done = false
    handler = happy(() => (done ? finishedJob() : { id: 'x', state: 'scheduled', enabled: true }))
    runner.resume()
    const r = await runner.start(trigger(), input(1))
    expect(r).toMatchObject({ ok: false, status: 429, error: 'too_many_events', event: { detail: '2 runs already running' } })
    done = true
    await poll()
    await until(() => expect(store.events(TID).filter(e => e.id.startsWith('old') && e.outcome === 'finished')).toHaveLength(2))
    expect((await runner.start(trigger(), input(2))).ok).toBe(true)
  })

  it('counts finished runs of the last hour toward the hourly cap', async () => {
    for (let i = 0; i < 10; i++) await store.logEvent(TID, { id: `f${i}`, at: NOW - 60_000, deliveryId: null, eventType: 'issues', action: null, outcome: 'finished', jobId: `j${i}`, runId: null, endedAt: null, detail: null })
    runner.resume()
    expect(await runner.start(trigger(), input(1))).toMatchObject({ ok: false, status: 429, event: { detail: '10 runs in the last hour' } })
  })
})
