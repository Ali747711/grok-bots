import { describe, expect, it } from 'vitest'

import { describeSchedule } from '../src/routines/describe-schedule.js'

describe('describeSchedule (server, 24-hour clock)', () => {
  it.each([
    [{ kind: 'daily', time: '09:05' }, 'Every day at 09:05'],
    [{ kind: 'weekdays', time: '18:30' }, 'Weekdays at 18:30'],
    [{ kind: 'weekly', day: 1, time: '07:00' }, 'Every Monday at 07:00'],
    [{ kind: 'monthly', day: 22, time: '12:00' }, 'Every month on the 22nd at 12:00'],
    [{ kind: 'monthly', day: 11, time: '12:00' }, 'Every month on the 11th at 12:00'],
    [{ kind: 'every', amount: 1, unit: 'h' }, 'Every hour'],
    [{ kind: 'every', amount: 15, unit: 'm' }, 'Every 15 minutes'],
    [{ kind: 'once_in', amount: 2, unit: 'd' }, 'Once, in 2 days'],
    [{ kind: 'once_at', at: '2026-11-09T21:00' }, 'Once on 2026-11-09 at 21:00'],
    [{ kind: 'cron', expr: '0 9 * * 1' }, '0 9 * * 1']
  ] as const)('%j → %s', (spec, text) => {
    expect(describeSchedule(spec as never)).toBe(text)
  })
})
