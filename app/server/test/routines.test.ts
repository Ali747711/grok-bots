import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { HermesRestError } from '../src/hermes/errors.js'
import type { HermesRest, RestMethod, RestOptions } from '../src/hermes/rest-client.js'
import { setLogSink } from '../src/log.js'
import { createRoutineService, type RoutineInput, type RoutineService } from '../src/routines/service.js'
import type { TriggerEvent, TriggerRun } from '../src/triggers/types.js'

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
      lastStatus: 'ok', lastError: null, running: false, state: 'scheduled', finished: false, triggerOnly: false
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

describe('state, finished and live runs', () => {
  it('reports state and finished for terminal states, leaving enabled as Hermes says', async () => {
    cron.handler = () => [job({ id: 'a', enabled: false, state: 'completed' }), job({ id: 'b', enabled: false, state: 'error' }), job({ id: 'c', enabled: false, state: 'paused' }), job({ id: 'd' }), job({ id: 'e', state: undefined })]
    const views = await svc.list('scout')
    expect(views.map(v => [v.state, v.finished, v.enabled])).toEqual([['completed', true, false], ['error', true, false], ['paused', false, false], ['scheduled', false, true], [null, false, true]])
  })

  it("shows running for a run Hermes reports as live even though Crew didn't trigger it", async () => {
    cron.handler = () => [job({ id: 'live', live_execution: { id: 'exec-1', status: 'running' } }), job({ id: 'idle', live_execution: null }), job({ id: 'none' })]
    expect((await svc.list('scout')).map(v => v.running)).toEqual([true, false, false])
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

  it('sends a set-time one-shot as an offset-aware instant in the routine zone', async () => {
    cron.handler = () => job()
    await svc.create('scout', { ...input, schedule: { kind: 'once_at', at: '2026-11-09T09:00' }, timezone: 'America/New_York' })
    expect(cron.last().body).toMatchObject({ schedule: '2026-11-09T09:00:00-05:00', timezone: 'America/New_York' })
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

  const putBody = () => (cron.calls.find(c => c.method === 'PUT')?.body as { updates: Record<string, unknown> } | undefined)?.updates
  const updated = { ...input, title: 'Evening brief', instruction: 'New words', deliverToChat: true, schedule: { kind: 'daily', time: '18:00' } as const, timezone: 'Asia/Seoul' }

  it('updates with the {updates} body and encodes the id', async () => {
    cron.handler = () => job()
    await svc.update('scout', 'a/b', { ...updated, timezoneChanged: true })
    expect(cron.calls.find(c => c.method === 'PUT')).toMatchObject({ path: '/api/cron/jobs/a%2Fb', query: { profile: 'scout' } })
    expect(putBody()).toEqual({ name: '[bot:scout] Evening brief', prompt: 'New words', schedule: '0 18 * * *', timezone: 'Asia/Seoul', deliver: 'bot-chat' })
  })

  it('sends only the prompt for a wording-only edit', async () => {
    cron.handler = () => job()
    await svc.update('scout', 'abc123', { ...input, instruction: 'Rephrased' })
    expect(putBody()).toEqual({ prompt: 'Rephrased' })
  })

  it('includes the schedule (and the zone, since the clock time moved) only for a schedule edit', async () => {
    cron.handler = () => job({ timezone: null })
    await svc.update('scout', 'abc123', { ...input, schedule: { kind: 'daily', time: '18:00' }, timezone: 'Asia/Seoul' })
    expect(putBody()).toEqual({ schedule: '0 18 * * *', timezone: 'Asia/Seoul' })
  })

  it('never pins a zone on a job that had none unless the user changed it', async () => {
    cron.handler = () => job({ timezone: null })
    await svc.update('scout', 'abc123', { ...input, title: 'Renamed', timezone: 'Asia/Seoul', timezoneChanged: false })
    expect(putBody()).toEqual({ name: '[bot:scout] Renamed' })
    cron.calls = []
    await svc.update('scout', 'abc123', { ...input, timezone: 'Asia/Seoul', timezoneChanged: true })
    expect(putBody()).toEqual({ timezone: 'Asia/Seoul' })
  })

  it('sends nothing when nothing changed', async () => {
    cron.handler = () => job()
    const view = await svc.update('scout', 'abc123', input)
    expect(cron.calls.map(c => c.method)).toEqual(['GET'])
    expect(view.id).toBe('abc123')
  })

  it('re-reads the job when the update reply is not a job', async () => {
    cron.handler = call => (call.method === 'PUT' ? { ok: true } : job())
    expect((await svc.update('scout', 'abc123', { ...input, instruction: 'x' })).id).toBe('abc123')
    expect(cron.calls.map(c => c.method)).toEqual(['GET', 'PUT', 'GET'])
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
    expect(cron.calls.find(c => c.path.endsWith('/trigger'))).toMatchObject({ method: 'POST', path: '/api/cron/jobs/abc123/trigger', query: { profile: 'scout' }, timeoutMs: 0 })
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
    cron.handler = call => { if (call.path.endsWith('/trigger')) throw new HermesRestError(409, 'Job is already running'); return job() }
    await expect(svc.runNow('scout', 'abc123')).resolves.toBe('already_running')
    cron.handler = call => { if (call.path.endsWith('/trigger')) throw new HermesRestError(404, 'Job not found'); return job() }
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

  it('only treats source cron rows as sessions', async () => {
    cron.handler = () => ({ runs: [
      { id: 'cron_output:abc123:exec:4', source: 'cron_output', title: 'COMPLETED · Morning brief', started_at: 5, ended_at: 6 },
      { id: 'sess-9', source: 'cron', title: 'CANCELLED · stopped by user', started_at: 7, ended_at: 8, is_active: false }
    ] })
    expect(await svc.runs('scout', 'abc123')).toEqual([
      { id: 'cron_output:abc123:exec:4', status: 'completed', startedAt: 5000, endedAt: 6000, title: 'Morning brief', sessionId: null, error: null },
      { id: 'sess-9', status: 'cancelled', startedAt: 7000, endedAt: 8000, title: 'CANCELLED · stopped by user', sessionId: 'sess-9', error: 'stopped by user' }
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

describe('runNow on a finished routine', () => {
  it('sends no trigger and never re-pauses it', async () => {
    cron.handler = () => job({ enabled: false, state: 'completed' })
    await expect(svc.runNow('scout', 'abc123')).resolves.toBe('finished')
    expect(cron.calls.map(c => c.path)).toEqual(['/api/cron/jobs/abc123'])
    cron.handler = () => job()
    await expect(svc.runNow('scout', 'abc123')).resolves.toBe('started')
  })
})

describe('runNow on a paused routine', () => {
  const paused = (extra: Record<string, unknown> = {}) => job({ enabled: false, state: 'paused', paused_reason: 'vacation', ...extra })
  const pauseCalls = () => cron.calls.filter(c => c.path.endsWith('/pause'))
  let settle: () => void
  const scripted = (current: unknown) => {
    cron.handler = call => {
      if (call.path.endsWith('/trigger')) return new Promise<void>(resolve => { settle = resolve }).then(() => job())
      if (call.path.endsWith('/pause') || call.path.endsWith('/resume')) return job()
      return call.path === '/api/cron/jobs' ? [current] : current
    }
  }
  afterEach(() => { vi.useRealTimers() })

  it('re-pauses exactly once after the trigger settles, and shows enabled false meanwhile', async () => {
    vi.useFakeTimers()
    scripted(paused())
    const started = svc.runNow('scout', 'abc123')
    await vi.advanceTimersByTimeAsync(3_000)
    await expect(started).resolves.toBe('started')
    expect(pauseCalls()).toHaveLength(0)
    // Hermes reports it enabled again once triggered; Crew still reports the user's pause.
    cron.handler = call => (call.path === '/api/cron/jobs' ? [job({ enabled: true, state: 'scheduled' })] : job())
    expect((await svc.list('scout'))[0]!.enabled).toBe(false)
    settle()
    await vi.advanceTimersByTimeAsync(0)
    expect(pauseCalls()).toHaveLength(1)
    expect(pauseCalls()[0]).toMatchObject({ method: 'POST', path: '/api/cron/jobs/abc123/pause', query: { profile: 'scout' } })
    expect((await svc.list('scout'))[0]!.enabled).toBe(true)
  })

  it('re-pauses before returning when the run is quick, and also after a 409 or an error', async () => {
    cron.handler = call => (call.path.endsWith('/trigger') ? job() : paused())
    await svc.runNow('scout', 'abc123')
    expect(pauseCalls()).toHaveLength(1)
    cron.handler = call => { if (call.path.endsWith('/trigger')) throw new HermesRestError(409, 'busy'); return paused() }
    await expect(svc.runNow('scout', 'abc123')).resolves.toBe('already_running')
    expect(pauseCalls()).toHaveLength(2)
    cron.handler = call => { if (call.path.endsWith('/trigger')) throw new HermesRestError(500, 'boom'); return paused() }
    await expect(svc.runNow('scout', 'abc123')).rejects.toMatchObject({ status: 500 })
    expect(pauseCalls()).toHaveLength(3)
  })

  it('does not pause a routine that was not paused', async () => {
    cron.handler = call => (call.path.endsWith('/trigger') ? job() : job())
    await svc.runNow('scout', 'abc123')
    expect(pauseCalls()).toHaveLength(0)
  })

  it('lets a resume or remove during the run win', async () => {
    vi.useFakeTimers()
    for (const action of ['resume', 'remove'] as const) {
      cron.calls = []
      scripted(paused())
      const started = svc.runNow('scout', 'abc123')
      await vi.advanceTimersByTimeAsync(3_000)
      await started
      await svc[action]('scout', 'abc123')
      settle()
      await vi.advanceTimersByTimeAsync(0)
      expect(pauseCalls()).toHaveLength(0)
    }
  })

  it('refuses to run when the job cannot be read, sending no trigger and leaving nothing running', async () => {
    cron.handler = call => { if (call.method === 'GET') throw new HermesRestError(502, 'gateway down'); return job() }
    await expect(svc.runNow('scout', 'abc123')).rejects.toMatchObject({ status: 502 })
    expect(cron.calls.filter(c => c.path.endsWith('/trigger'))).toHaveLength(0)
    cron.handler = () => job()
    await expect(svc.runNow('scout', 'abc123')).resolves.toBe('started')
  })

  it('warns when the re-pause fails', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    cron.handler = call => { if (call.path.endsWith('/pause')) throw new Error('down'); return call.path.endsWith('/trigger') ? job() : paused() }
    try { await svc.runNow('scout', 'abc123') } finally { restore() }
    expect(lines.map(l => JSON.parse(l)).filter(l => l.level === 'warn')).toEqual([expect.objectContaining({ msg: 're-pause after run now failed', jobId: 'abc123' })])
  })
})

const MARKER = 'crew:trigger-only'
const oneShot = (id: string) => job({ id, name: `[trigger:${'a'.repeat(32)}] Morning brief · push` })

describe('event-only routines', () => {
  const putBodies = () => cron.calls.filter(c => c.method === 'PUT').map(c => c.body)
  const pauseCalls = () => cron.calls.filter(c => c.path.endsWith('/pause'))
  const triggered: RoutineInput = { ...input, runs: 'triggered' }
  afterEach(() => { vi.useRealTimers() })

  it('hides [trigger:...] one-shots from the routine list', async () => {
    cron.handler = () => [job(), oneShot('shot1')]
    expect((await svc.list('scout')).map(v => v.id)).toEqual(['abc123'])
  })

  it('creates an event-only routine paused with the yearly schedule and the marker', async () => {
    cron.handler = () => job()
    await svc.create('scout', triggered)
    expect(cron.last().body).toMatchObject({ schedule: '0 3 1 1 *', paused: true, paused_reason: MARKER, name: '[bot:scout] Morning brief' })
    await svc.create('scout', input)
    expect(cron.last().body).not.toHaveProperty('paused')
  })

  it('shows a trigger-only routine as triggerOnly and a normally paused one as not', async () => {
    cron.handler = () => [job({ id: 'a', enabled: false, state: 'paused', paused_reason: MARKER }), job({ id: 'b', enabled: false, state: 'paused', paused_reason: 'vacation' }), job({ id: 'c' })]
    expect((await svc.list('scout')).map(v => v.triggerOnly)).toEqual([true, false, false])
  })

  it('switches a routine to event-only: changes, pause, then the marker', async () => {
    cron.handler = () => job()
    await svc.update('scout', 'abc123', triggered)
    expect(cron.calls.map(c => [c.method, c.path])).toEqual([
      ['GET', '/api/cron/jobs/abc123'], ['PUT', '/api/cron/jobs/abc123'], ['POST', '/api/cron/jobs/abc123/pause'], ['PUT', '/api/cron/jobs/abc123'], ['GET', '/api/cron/jobs/abc123']
    ])
    expect(putBodies()).toEqual([{ updates: { schedule: '0 3 1 1 *' } }, { updates: { paused_reason: MARKER } }])
  })

  it('switches an event-only routine back to a schedule and resumes it', async () => {
    cron.handler = () => job({ enabled: false, state: 'paused', paused_reason: MARKER, schedule: { kind: 'cron', expr: '0 3 1 1 *', display: '0 3 1 1 *' }, schedule_display: '0 3 1 1 *' })
    await svc.update('scout', 'abc123', input)
    expect(putBodies()).toEqual([{ updates: { schedule: '0 9 * * *' } }])
    expect(cron.calls.map(c => [c.method, c.path.replace('/api/cron/jobs/abc123', '')])).toEqual([['GET', ''], ['PUT', ''], ['POST', '/resume'], ['GET', '']])
  })

  it('editing an event-only routine without changing the mode sends no pause or marker', async () => {
    cron.handler = () => job({ enabled: false, state: 'paused', paused_reason: MARKER, schedule: { kind: 'cron', expr: '0 3 1 1 *', display: '0 3 1 1 *' }, schedule_display: '0 3 1 1 *' })
    await svc.update('scout', 'abc123', { ...triggered, instruction: 'Rephrased' })
    expect(putBodies()).toEqual([{ updates: { prompt: 'Rephrased' } }])
    expect(pauseCalls()).toHaveLength(0)
  })

  const markedPaused = () => job({ enabled: false, state: 'paused', paused_reason: MARKER })
  let settle: () => void
  const scripted = () => {
    cron.handler = call => {
      if (call.path.endsWith('/trigger')) return new Promise<void>(resolve => { settle = resolve }).then(() => job())
      if (call.path.endsWith('/pause') || call.path.endsWith('/resume') || call.method === 'PUT') return job()
      return call.path === '/api/cron/jobs' ? [markedPaused()] : markedPaused()
    }
  }

  it('re-pauses a trigger-only routine with its marker after Run now', async () => {
    vi.useFakeTimers()
    scripted()
    const started = svc.runNow('scout', 'abc123')
    await vi.advanceTimersByTimeAsync(3_000)
    await started
    // Hermes cleared the marker and enabled the job while it runs; Crew still shows it as trigger-only.
    cron.handler = call => (call.path === '/api/cron/jobs' ? [job({ enabled: true, state: 'scheduled' })] : job())
    const [view] = await svc.list('scout')
    expect(view).toMatchObject({ triggerOnly: true, enabled: false })
    cron.calls = []
    settle()
    await vi.advanceTimersByTimeAsync(0)
    expect(cron.calls.map(c => [c.method, c.path])).toEqual([['POST', '/api/cron/jobs/abc123/pause'], ['PUT', '/api/cron/jobs/abc123']])
    expect(cron.calls[1]!.body).toEqual({ updates: { paused_reason: MARKER } })
  })

  it('a user resume during Run now drops the marker restore', async () => {
    vi.useFakeTimers()
    scripted()
    const started = svc.runNow('scout', 'abc123')
    await vi.advanceTimersByTimeAsync(3_000)
    await started
    await svc.resume('scout', 'abc123')
    cron.calls = []
    settle()
    await vi.advanceTimersByTimeAsync(0)
    expect(cron.calls).toEqual([])
  })

  it('does not restore a marker on a routine that was only normally paused', async () => {
    vi.useFakeTimers()
    cron.handler = call => (call.path.endsWith('/trigger') ? job() : job({ enabled: false, state: 'paused', paused_reason: 'vacation' }))
    const started = svc.runNow('scout', 'abc123')
    await vi.advanceTimersByTimeAsync(0)
    await started
    expect(cron.calls.filter(c => c.method === 'PUT')).toEqual([])
    expect(pauseCalls()).toHaveLength(1)
  })

  it('merges trigger runs into the history, newest first, limit after merging', async () => {
    const ev = (n: number, over: Partial<TriggerEvent>): TriggerEvent => ({ id: `e${n}`, at: n * 1000, deliveryId: null, eventType: 'push', action: null, outcome: 'finished', jobId: 'j', runId: null, endedAt: n * 1000 + 500, detail: null, ...over })
    const runs: TriggerRun[] = [
      { triggerId: 't', triggerName: 'Pushes', event: ev(2, { runId: 's2' }) },
      { triggerId: 't', triggerName: 'Pushes', event: ev(4, { outcome: 'failed', runId: 's4', detail: 'boom' }) }
    ]
    const merged = createRoutineService({ rest: cron.rest, now: () => 1_000, triggerRuns: (bot, id) => (bot === 'scout' && id === 'abc123' ? runs : []) })
    cron.handler = () => ({ runs: [
      { id: 'r3', source: 'cron', title: 'Morning brief', started_at: 3, ended_at: 3.5 },
      { id: 'r1', source: 'cron', title: 'Morning brief', started_at: 1, ended_at: 1.5 }
    ] })
    const out = await merged.runs('scout', 'abc123', 3)
    expect(out.map(r => r.id)).toEqual(['trigger:e4', 'r3', 'trigger:e2'])
    expect(out[2]).toEqual({ id: 'trigger:e2', status: 'completed', startedAt: 2000, endedAt: 2500, title: 'Pushes · push', sessionId: 's2', error: null, trigger: { id: 't', name: 'Pushes', eventType: 'push' } })
    expect(out[0]).toMatchObject({ status: 'failed', error: 'boom' })
  })
})
