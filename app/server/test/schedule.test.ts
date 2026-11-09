import { describe, expect, it } from 'vitest'

import { fromHermesSchedule, previewRuns, ScheduleError, type ScheduleSpec, toHermesSchedule } from '../src/routines/schedule.js'

const specs: ScheduleSpec[] = [
  { kind: 'once_in', amount: 30, unit: 'm' },
  { kind: 'once_at', at: '2026-11-09T09:00' },
  { kind: 'every', amount: 2, unit: 'h' },
  { kind: 'every', amount: 3, unit: 'd' },
  { kind: 'every', amount: 45, unit: 'm' },
  { kind: 'daily', time: '09:30' },
  { kind: 'weekdays', time: '07:05' },
  { kind: 'weekly', day: 1, time: '09:30' },
  { kind: 'weekly', day: 0, time: '00:00' },
  { kind: 'monthly', day: 15, time: '09:30' },
  { kind: 'cron', expr: '*/5 * * * *' }
]

describe('toHermesSchedule', () => {
  it('sends a one-shot as an instant with the routine zone offset (Hermes ignores job timezone for one-shots)', () => {
    expect(toHermesSchedule({ kind: 'once_at', at: '2026-11-09T09:00' }, 'Asia/Seoul')).toBe('2026-11-09T09:00:00+09:00')
    expect(toHermesSchedule({ kind: 'once_at', at: '2026-11-09T09:00' }, 'America/New_York')).toBe('2026-11-09T09:00:00-05:00')
    expect(toHermesSchedule({ kind: 'once_at', at: '2026-11-09T09:00' }, 'UTC')).toBe('2026-11-09T09:00:00Z')
    expect(() => toHermesSchedule({ kind: 'once_at', at: '2026-13-09T09:00' }, 'UTC')).toThrowError(expect.objectContaining({ code: 'invalid' }))
  })

  it.each([
    [{ kind: 'once_in', amount: 30, unit: 'm' }, 'in 30m'],
    [{ kind: 'every', amount: 2, unit: 'h' }, 'every 2h'],
    [{ kind: 'daily', time: '09:30' }, '30 9 * * *'],
    [{ kind: 'weekdays', time: '09:30' }, '30 9 * * 1-5'],
    [{ kind: 'weekly', day: 1, time: '09:30' }, '30 9 * * 1'],
    [{ kind: 'monthly', day: 15, time: '09:30' }, '30 9 15 * *'],
    [{ kind: 'cron', expr: '  0 9 * * *  ' }, '0 9 * * *']
  ])('composes %j as %s', (spec, out) => expect(toHermesSchedule(spec as ScheduleSpec, 'UTC')).toBe(out))
})

describe('fromHermesSchedule', () => {
  it('maps intervals to the largest whole unit', () => {
    expect(fromHermesSchedule({ kind: 'interval', minutes: 120 }, 'UTC')).toEqual({ kind: 'every', amount: 2, unit: 'h' })
    expect(fromHermesSchedule({ kind: 'interval', minutes: 2880 }, 'UTC')).toEqual({ kind: 'every', amount: 2, unit: 'd' })
    expect(fromHermesSchedule({ kind: 'interval', minutes: 45 }, 'UTC')).toEqual({ kind: 'every', amount: 45, unit: 'm' })
  })

  it('keeps unknown cron expressions as cron', () => {
    expect(fromHermesSchedule({ kind: 'cron', expr: '0 9 * * 1,3' }, 'UTC')).toEqual({ kind: 'cron', expr: '0 9 * * 1,3' })
    expect(fromHermesSchedule({ kind: 'cron', expr: '61 9 * * *' }, 'UTC')).toEqual({ kind: 'cron', expr: '61 9 * * *' })
  })

  it('shows a one-shot in the given zone, with or without an offset', () => {
    expect(fromHermesSchedule({ kind: 'once', run_at: '2026-11-09T00:00:00+00:00' }, 'Asia/Seoul')).toEqual({ kind: 'once_at', at: '2026-11-09T09:00' })
    expect(fromHermesSchedule({ kind: 'once', run_at: '2026-11-09T09:00:00' }, 'Asia/Seoul')).toEqual({ kind: 'once_at', at: '2026-11-09T09:00' })
  })

  it('round-trips every generated cron kind exactly', () => {
    for (const spec of specs.filter(x => ['daily', 'weekdays', 'weekly', 'monthly', 'cron'].includes(x.kind))) {
      expect(fromHermesSchedule({ kind: 'cron', expr: toHermesSchedule(spec, 'UTC') }, 'UTC')).toEqual(spec)
    }
  })

  it('round-trips intervals and one-shots', () => {
    for (const spec of specs.filter(x => x.kind === 'every') as Extract<ScheduleSpec, { kind: 'every' }>[]) {
      const minutes = spec.amount * { m: 1, h: 60, d: 1440 }[spec.unit]
      const back = fromHermesSchedule({ kind: 'interval', minutes }, 'UTC')
      expect(back.kind === 'every' && back.amount * { m: 1, h: 60, d: 1440 }[back.unit]).toBe(minutes)
    }
    const once = fromHermesSchedule({ kind: 'once', run_at: '2026-11-09T09:00:00' }, 'Asia/Seoul')
    expect(toHermesSchedule(once, 'Asia/Seoul')).toBe('2026-11-09T09:00:00+09:00')
  })
})

describe('previewRuns', () => {
  const now = Date.parse('2026-11-08T12:00:00Z')
  const iso = (ms: number) => new Date(ms).toISOString()

  it('previews a daily 09:00 in Asia/Seoul', () => {
    const runs = previewRuns({ kind: 'daily', time: '09:00' }, 'Asia/Seoul', now)
    expect(runs.map(iso)).toEqual(['2026-11-09T00:00:00.000Z', '2026-11-10T00:00:00.000Z', '2026-11-11T00:00:00.000Z'])
  })

  it('handles a DST transition', () => {
    const runs = previewRuns({ kind: 'daily', time: '09:00' }, 'America/New_York', Date.parse('2026-10-31T12:00:00Z'))
    expect(runs.map(iso)).toEqual(['2026-10-31T13:00:00.000Z', '2026-11-01T14:00:00.000Z', '2026-11-02T14:00:00.000Z'])
  })

  it('previews weekdays, weekly and monthly kinds', () => {
    // 2026-11-08 is a Sunday.
    expect(previewRuns({ kind: 'weekdays', time: '09:00' }, 'UTC', now).map(iso)[0]).toBe('2026-11-09T09:00:00.000Z')
    expect(previewRuns({ kind: 'weekly', day: 3, time: '09:00' }, 'UTC', now).map(iso)[0]).toBe('2026-11-11T09:00:00.000Z')
    expect(previewRuns({ kind: 'monthly', day: 15, time: '09:00' }, 'UTC', now).map(iso)[0]).toBe('2026-11-15T09:00:00.000Z')
  })

  it('previews delays and intervals from now', () => {
    expect(previewRuns({ kind: 'once_in', amount: 30, unit: 'm' }, 'UTC', now)).toEqual([now + 30 * 60_000])
    expect(previewRuns({ kind: 'every', amount: 2, unit: 'h' }, 'UTC', now)).toEqual([now + 7_200_000, now + 14_400_000, now + 21_600_000])
  })

  it('previews a future one-shot in its zone and rejects one in the past', () => {
    expect(previewRuns({ kind: 'once_at', at: '2026-11-09T09:00' }, 'Asia/Seoul', now).map(iso)).toEqual(['2026-11-09T00:00:00.000Z'])
    expect(() => previewRuns({ kind: 'once_at', at: '2026-11-08T09:00' }, 'UTC', now)).toThrowError(expect.objectContaining({ code: 'in_past' }))
    expect(() => previewRuns({ kind: 'once_at', at: '2026-11-08T09:00' }, 'UTC', now)).toThrow(ScheduleError)
  })

  it('rejects an unparseable cron expression, a bad time or an unknown zone as invalid', () => {
    expect(() => previewRuns({ kind: 'cron', expr: 'not a cron' }, 'UTC', now)).toThrowError(expect.objectContaining({ code: 'invalid' }))
    expect(() => previewRuns({ kind: 'daily', time: '25:99' }, 'UTC', now)).toThrowError(expect.objectContaining({ code: 'invalid' }))
    expect(() => previewRuns({ kind: 'daily', time: '09:00' }, 'Mars/Base', now)).toThrowError(expect.objectContaining({ code: 'invalid' }))
    expect(() => previewRuns({ kind: 'once_at', at: 'tomorrow' }, 'UTC', now)).toThrowError(expect.objectContaining({ code: 'invalid' }))
  })
})
