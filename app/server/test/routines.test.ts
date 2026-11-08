import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HermesRestError } from '../src/hermes/errors.js'
import type { HermesRest, RestMethod, RestOptions } from '../src/hermes/rest-client.js'
import { setLogSink } from '../src/log.js'
import { createRoutineService, type RoutineInput, type RoutineService } from '../src/routines/service.js'

interface Call { method: string; path: string; query?: Record<string, string>; body?: unknown; timeoutMs?: number }

class FakeCron {
  calls: Call[] = []
  handler: (call: Call) => unknown = () => ({})
  last(): Call { return this.calls.at(-1)! }
  rest: HermesRest = {
    request: async <T>(method: RestMethod, path: string, opts: RestOptions = {}): Promise<T> => {
      const call: Call = { method, path, ...(opts.query ? { query: opts.query } : {}), ...(opts.body === undefined ? {} : { body: opts.body }), ...(opts.timeoutMs === undefined ? {} : { timeoutMs: opts.timeoutMs }) }
      this.calls.push(call)
      return this.handler(call) as T
    }
  }
}

const iso = '2026-11-09T00:00:00+00:00'
const job = (extra: Record<string, unknown> = {}) => ({
  id: 'abc123', name: '[bot:scout] Morning brief', prompt: 'Summarise the news', profile: 'scout', enabled: true, state: 'scheduled', deliver: 'local',
  schedule: { kind: 'cron', expr: '0 9 * * *', display: '0 9 * * *' }, schedule_display: '0 9 * * *', timezone: 'Asia/Seoul',
  next_run_at: iso, last_run_at: '2026-11-08T00:00:00+00:00', last_status: 'ok', ...extra
})
const input: RoutineInput = { title: 'Morning brief', instruction: 'Summarise the news', schedule: { kind: 'daily', time: '09:00' }, timezone: 'Asia/Seoul', deliverToChat: false }

let cron: FakeCron
let svc: RoutineService
beforeEach(() => {
  cron = new FakeCron()
  svc = createRoutineService({ rest: cron.rest, now: () => 1_000 })
})

describe('list', () => {
  it('maps jobs to views, scoped to the bot', async () => {
    cron.handler = () => [job(), job({ id: 'other', profile: 'default', name: 'x' })]
    const views = await svc.list('scout')
    expect(cron.last()).toMatchObject({ method: 'GET', path: '/api/cron/jobs', query: { profile: 'scout' } })
    expect(views).toEqual([{
      id: 'abc123', bot: 'scout', title: 'Morning brief', instruction: 'Summarise the news', schedule: { kind: 'daily', time: '09:00' }, scheduleText: '0 9 * * *',
      timezone: 'Asia/Seoul', deliverToChat: false, enabled: true, nextRunAt: Date.parse(iso), lastRunAt: Date.parse('2026-11-08T00:00:00+00:00'),
      lastStatus: 'ok', lastError: null, running: false
    }])
  })

  it('reads chat delivery, paused state, errors and interval schedules', async () => {
    cron.handler = () => [job({
      deliver: 'bot-chat', enabled: false, state: 'paused', last_status: 'error', last_error: 'model error',
      schedule: { kind: 'interval', minutes: 120, display: 'every 120m' }, next_run_at: null
    })]
    const [view] = await svc.list('scout')
    expect(view).toMatchObject({ deliverToChat: true, enabled: false, lastStatus: 'error', lastError: 'model error', nextRunAt: null, schedule: { kind: 'every', amount: 2, unit: 'h' } })
  })

  it('degrades an unexpected shape instead of crashing and warns once for an unparseable row', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    cron.handler = () => [{ id: 'bare' }, { nope: true }, job({ last_status: 'weird', next_run_at: 'garbage' })]
    let views
    try { views = await svc.list('scout') } finally { restore() }
    expect(views!.map(v => v.id)).toEqual(['bare', 'abc123'])
    expect(views![0]).toMatchObject({ title: '', instruction: '', enabled: true, nextRunAt: null, lastStatus: null, timezone: null })
    expect(views![1]).toMatchObject({ lastStatus: null, nextRunAt: null })
    expect(lines.filter(l => JSON.parse(l).level === 'warn')).toHaveLength(1)
  })
})

describe('create and update', () => {
  it("creates the job in the bot's store with the official name", async () => {
    cron.handler = () => job()
    const view = await svc.create('scout', input)
    expect(cron.last()).toMatchObject({ method: 'POST', path: '/api/cron/jobs', query: { profile: 'scout' },
      body: { name: '[bot:scout] Morning brief', prompt: 'Summarise the news', deliver: 'local', schedule: '0 9 * * *', timezone: 'Asia/Seoul' } })
    expect(view.id).toBe('abc123')
  })

  it('sends in <n><unit> for one-shot delays and bot-chat delivery on request', async () => {
    cron.handler = () => job()
    await svc.create('scout', { ...input, schedule: { kind: 'once_in', amount: 30, unit: 'm' }, deliverToChat: true })
    expect(cron.last().body).toMatchObject({ schedule: 'in 30m', deliver: 'bot-chat' })
  })

  it("surfaces Hermes's rejection message", async () => {
    cron.handler = () => { throw new HermesRestError(400, 'Blocked: prompt matches a threat pattern') }
    await expect(svc.create('scout', input)).rejects.toMatchObject({ status: 400, detail: 'Blocked: prompt matches a threat pattern' })
  })

  it('updates with the {updates} body and encodes the id', async () => {
    cron.handler = () => job()
    await svc.update('scout', 'a/b', input)
    expect(cron.last()).toMatchObject({ method: 'PUT', path: '/api/cron/jobs/a%2Fb', query: { profile: 'scout' },
      body: { updates: { name: '[bot:scout] Morning brief', prompt: 'Summarise the news', schedule: '0 9 * * *', timezone: 'Asia/Seoul', deliver: 'local' } } })
  })

  it('re-reads the job when the update reply is not a job', async () => {
    cron.handler = call => (call.method === 'PUT' ? { ok: true } : job())
    expect((await svc.update('scout', 'abc123', input)).id).toBe('abc123')
    expect(cron.calls.map(c => c.method)).toEqual(['PUT', 'GET'])
  })
})

describe('pause, resume and remove', () => {
  it('pauses and resumes and returns the view', async () => {
    cron.handler = () => job({ enabled: false })
    expect((await svc.pause('scout', 'abc123')).enabled).toBe(false)
    expect(cron.last()).toMatchObject({ method: 'POST', path: '/api/cron/jobs/abc123/pause', query: { profile: 'scout' } })
    await svc.resume('scout', 'abc123')
    expect(cron.last().path).toBe('/api/cron/jobs/abc123/resume')
  })

  it('removes a job', async () => {
    await svc.remove('scout', 'abc123')
    expect(cron.last()).toMatchObject({ method: 'DELETE', path: '/api/cron/jobs/abc123', query: { profile: 'scout' } })
  })
})

describe('runNow', () => {
  afterEach(() => { vi.useRealTimers() })

  it('returns started while the trigger is still pending, and tracks running until it settles', async () => {
    vi.useFakeTimers()
    let settle!: () => void
    cron.handler = call => (call.path.endsWith('/trigger') ? new Promise<void>(resolve => { settle = resolve }).then(() => job()) : [job()])
    const started = svc.runNow('scout', 'abc123')
    await vi.advanceTimersByTimeAsync(3_000)
    await expect(started).resolves.toBe('started')
    expect(cron.calls[0]).toMatchObject({ method: 'POST', path: '/api/cron/jobs/abc123/trigger', query: { profile: 'scout' }, timeoutMs: 0 })
    expect((await svc.list('scout'))[0]!.running).toBe(true)
    await expect(svc.runNow('scout', 'abc123')).resolves.toBe('already_running')
    settle()
    await vi.advanceTimersByTimeAsync(0)
    expect((await svc.list('scout'))[0]!.running).toBe(false)
  })

  it('returns started when the trigger settles quickly', async () => {
    cron.handler = () => job()
    await expect(svc.runNow('scout', 'abc123')).resolves.toBe('started')
  })

  it('reports already_running on a 409 and throws other errors', async () => {
    cron.handler = () => { throw new HermesRestError(409, 'Job is already running') }
    await expect(svc.runNow('scout', 'abc123')).resolves.toBe('already_running')
    cron.handler = () => { throw new HermesRestError(404, 'Job not found') }
    await expect(svc.runNow('scout', 'abc123')).rejects.toMatchObject({ status: 404 })
    cron.handler = () => job()
    await expect(svc.runNow('scout', 'abc123')).resolves.toBe('started')
  })

  it('logs a late failure once at info and clears the running flag', async () => {
    vi.useFakeTimers()
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    let fail!: (e: Error) => void
    cron.handler = call => (call.path.endsWith('/trigger') ? new Promise((_r, reject) => { fail = reject }) : [job()])
    try {
      const started = svc.runNow('scout', 'abc123')
      await vi.advanceTimersByTimeAsync(3_000)
      await started
      fail(new Error('fetch failed: headers timeout'))
      await vi.advanceTimersByTimeAsync(0)
      expect((await svc.list('scout'))[0]!.running).toBe(false)
    } finally { restore() }
    const infos = lines.map(l => JSON.parse(l)).filter(l => l.level === 'info')
    expect(infos).toEqual([expect.objectContaining({ msg: 'run-now request ended', jobId: 'abc123' })])
  })
})

describe('runs', () => {
  it('maps session rows and requests the limit', async () => {
    cron.handler = () => ({ runs: [
      { id: 's1', source: 'cron', title: 'Morning brief', started_at: 1_700_000_000, ended_at: 1_700_000_060, is_active: false },
      { id: 's2', source: 'cron', title: 'Morning brief', started_at: 1_700_000_100, ended_at: null, is_active: true }
    ], limit: 20 })
    const runs = await svc.runs('scout', 'abc123', 5)
    expect(cron.last()).toMatchObject({ method: 'GET', path: '/api/cron/jobs/abc123/runs', query: { profile: 'scout', limit: '5' } })
    expect(runs).toEqual([
      { id: 's1', status: 'completed', startedAt: 1_700_000_000_000, endedAt: 1_700_000_060_000, title: 'Morning brief', sessionId: 's1', error: null },
      { id: 's2', status: 'running', startedAt: 1_700_000_100_000, endedAt: null, title: 'Morning brief', sessionId: 's2', error: null }
    ])
  })

  it('maps a synthesized failed run row', async () => {
    cron.handler = () => ({ runs: [{ id: 'x1', source: 'cron_output', title: 'FAILED · model error', started_at: 1_700_000_000, ended_at: 1_700_000_005, is_active: false }] })
    expect(await svc.runs('scout', 'abc123')).toEqual([
      { id: 'x1', status: 'failed', startedAt: 1_700_000_000_000, endedAt: 1_700_000_005_000, title: 'FAILED · model error', sessionId: null, error: 'model error' }
    ])
  })

  it('maps cancelled and missed rows', async () => {
    cron.handler = () => ({ runs: [
      { id: 'c', title: 'CANCELLED · stopped by user', started_at: 1 },
      { id: 'm', title: 'MISSED · scheduler down', started_at: 2 }
    ] })
    expect((await svc.runs('scout', 'abc123')).map(r => [r.status, r.error, r.sessionId])).toEqual([['cancelled', 'stopped by user', null], ['missed', 'scheduler down', null]])
  })
})
