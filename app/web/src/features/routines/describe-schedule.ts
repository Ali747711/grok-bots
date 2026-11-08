import type { ScheduleSpec, Unit } from './types'

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const UNIT: Record<Unit, string> = { m: 'minute', h: 'hour', d: 'day' }

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th, 21st. */
function ordinal(n: number): string {
  const tens = n % 100
  if (tens >= 11 && tens <= 13) return `${n}th`
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`
}

/** "09:30" shown in the viewer's 12 or 24 hour style. */
function clock(time: string, locale?: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number)
  return new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(new Date(2000, 0, 1, hour, minute))
}

function plural(amount: number, unit: Unit): string {
  return amount === 1 ? `1 ${UNIT[unit]}` : `${amount} ${UNIT[unit]}s`
}

function every(amount: number, unit: Unit): string {
  return amount === 1 ? `Every ${UNIT[unit]}` : `Every ${plural(amount, unit)}`
}

/** A wall-clock `YYYY-MM-DDTHH:MM` as "Nov 9, 9:00 AM" (no zone conversion: it is the time in the routine's own zone). */
function onceAt(at: string, locale?: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})$/.exec(at)
  if (!match) return at
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const day = new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date)
  return `${day}, ${clock(match[4] ?? '00:00', locale)}`
}

/** What a schedule means, in words a person would say. A cron expression is shown as typed. */
export function describeSchedule(spec: ScheduleSpec, locale?: string): string {
  switch (spec.kind) {
    case 'daily': return `Every day at ${clock(spec.time, locale)}`
    case 'weekdays': return `Weekdays at ${clock(spec.time, locale)}`
    case 'weekly': return `Every ${DAYS[spec.day] ?? 'week'} at ${clock(spec.time, locale)}`
    case 'monthly': return `Every month on the ${ordinal(spec.day)} at ${clock(spec.time, locale)}`
    case 'every': return every(spec.amount, spec.unit)
    case 'once_in': return `Once, in ${plural(spec.amount, spec.unit)}`
    case 'once_at': return `Once on ${onceAt(spec.at, locale)}`
    case 'cron': return spec.expr
  }
}
