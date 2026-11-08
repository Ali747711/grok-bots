import { describe, expect, it } from 'vitest'

import { describeSchedule } from '@/features/routines/describe-schedule'
import type { ScheduleSpec } from '@/features/routines/types'

const text = (spec: ScheduleSpec) => describeSchedule(spec, 'en-US').replace(/\s/g, ' ')

describe('describeSchedule', () => {
  const cases: [ScheduleSpec, string][] = [
    [{ kind: 'daily', time: '09:00' }, 'Every day at 9:00 AM'],
    [{ kind: 'daily', time: '18:45' }, 'Every day at 6:45 PM'],
    [{ kind: 'weekdays', time: '09:30' }, 'Weekdays at 9:30 AM'],
    [{ kind: 'weekly', day: 1, time: '09:00' }, 'Every Monday at 9:00 AM'],
    [{ kind: 'weekly', day: 0, time: '09:00' }, 'Every Sunday at 9:00 AM'],
    [{ kind: 'monthly', day: 15, time: '09:00' }, 'Every month on the 15th at 9:00 AM'],
    [{ kind: 'monthly', day: 1, time: '09:00' }, 'Every month on the 1st at 9:00 AM'],
    [{ kind: 'monthly', day: 2, time: '09:00' }, 'Every month on the 2nd at 9:00 AM'],
    [{ kind: 'monthly', day: 3, time: '09:00' }, 'Every month on the 3rd at 9:00 AM'],
    [{ kind: 'monthly', day: 11, time: '09:00' }, 'Every month on the 11th at 9:00 AM'],
    [{ kind: 'monthly', day: 22, time: '09:00' }, 'Every month on the 22nd at 9:00 AM'],
    [{ kind: 'every', amount: 2, unit: 'h' }, 'Every 2 hours'],
    [{ kind: 'every', amount: 1, unit: 'h' }, 'Every hour'],
    [{ kind: 'every', amount: 30, unit: 'm' }, 'Every 30 minutes'],
    [{ kind: 'every', amount: 1, unit: 'm' }, 'Every minute'],
    [{ kind: 'every', amount: 1, unit: 'd' }, 'Every day'],
    [{ kind: 'every', amount: 3, unit: 'd' }, 'Every 3 days'],
    [{ kind: 'once_in', amount: 30, unit: 'm' }, 'Once, in 30 minutes'],
    [{ kind: 'once_in', amount: 1, unit: 'h' }, 'Once, in 1 hour'],
    [{ kind: 'once_at', at: '2026-11-09T09:00' }, 'Once on Nov 9, 9:00 AM'],
    [{ kind: 'cron', expr: '*/15 * * * *' }, '*/15 * * * *']
  ]
  it.each(cases)('%j -> %s', (spec, expected) => {
    expect(text(spec)).toBe(expected)
  })
})
