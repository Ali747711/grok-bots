import type { ScheduleSpec } from './schedule.js'

type Unit = 'm' | 'h' | 'd'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const UNIT: Record<Unit, string> = { m: 'minute', h: 'hour', d: 'day' }

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st. */
function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

const plural = (amount: number, unit: Unit): string => (amount === 1 ? `1 ${UNIT[unit]}` : `${amount} ${UNIT[unit]}s`)
const every = (amount: number, unit: Unit): string => (amount === 1 ? `Every ${UNIT[unit]}` : `Every ${plural(amount, unit)}`)

/**
 * A schedule in words for a bot's own prompt. Port of the web's `describeSchedule` with a fixed 24-hour
 * `HH:MM` clock and no locale: the server has no viewer, and the bot reads it, not a person.
 */
export function describeSchedule(spec: ScheduleSpec): string {
  switch (spec.kind) {
    case 'daily': return `Every day at ${spec.time}`
    case 'weekdays': return `Weekdays at ${spec.time}`
    case 'weekly': return `Every ${DAYS[spec.day] ?? 'week'} at ${spec.time}`
    case 'monthly': return `Every month on the ${ordinal(spec.day)} at ${spec.time}`
    case 'every': return every(spec.amount, spec.unit)
    case 'once_in': return `Once, in ${plural(spec.amount, spec.unit)}`
    case 'once_at': return `Once on ${spec.at.replace('T', ' at ')}`
    case 'cron': return spec.expr
  }
}
