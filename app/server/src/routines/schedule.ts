import { CronExpressionParser } from 'cron-parser'
import { DateTime, IANAZone } from 'luxon'
import { z } from 'zod'

const MINUTES = { m: 1, h: 60, d: 1440 } as const
const MS_PER_MINUTE = 60_000
const AT_FORMAT = "yyyy-MM-dd'T'HH:mm"
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

const unit = z.enum(['m', 'h', 'd'])
const amount = z.number().int().min(1).max(999)
const time = z.string().regex(TIME_RE)

export const scheduleSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once_in'), amount, unit }),
  z.object({ kind: z.literal('once_at'), at: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/) }),
  z.object({ kind: z.literal('every'), amount, unit }),
  z.object({ kind: z.literal('daily'), time }),
  z.object({ kind: z.literal('weekdays'), time }),
  z.object({ kind: z.literal('weekly'), day: z.number().int().min(0).max(6), time }),
  z.object({ kind: z.literal('monthly'), day: z.number().int().min(1).max(31), time }),
  z.object({ kind: z.literal('cron'), expr: z.string().trim().min(1).max(200) })
])

export type ScheduleSpec = z.infer<typeof scheduleSpecSchema>

export interface HermesScheduleRaw {
  readonly kind: 'once' | 'interval' | 'cron'
  readonly run_at?: string | null
  readonly minutes?: number | null
  readonly expr?: string | null
}

export class ScheduleError extends Error {
  constructor(
    readonly code: 'in_past' | 'invalid',
    message: string
  ) {
    super(message)
    this.name = 'ScheduleError'
  }
}

const invalid = (message: string): ScheduleError => new ScheduleError('invalid', message)

function hourMinute(value: string): { hour: number; minute: number } {
  const match = TIME_RE.exec(value)
  if (!match) throw invalid(`invalid time '${value}'`)
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

/**
 * A set-time one-shot as an offset-aware instant: Hermes localises a naive timestamp to ITS zone and
 * ignores the job `timezone` for one-shots, so the routine's zone must travel in the string itself.
 */
function onceAtInstant(at: string, timezone: string): string {
  const iso = DateTime.fromFormat(at, AT_FORMAT, { zone: timezone }).toISO({ suppressMilliseconds: true })
  if (!iso) throw invalid(`invalid date and time '${at}'`)
  return iso
}

/** The string Hermes parses (F§4.4): one-shots are `in <n><unit>`, never a bare duration. */
export function toHermesSchedule(spec: ScheduleSpec, timezone: string): string {
  switch (spec.kind) {
    case 'once_in': return `in ${spec.amount}${spec.unit}`
    case 'once_at': return onceAtInstant(spec.at, timezone)
    case 'every': return `every ${spec.amount}${spec.unit}`
    case 'cron': return spec.expr.trim()
    default: return cronFor(spec)
  }
}

function cronFor(spec: Extract<ScheduleSpec, { time: string }>): string {
  const { hour, minute } = hourMinute(spec.time)
  const at = `${minute} ${hour}`
  switch (spec.kind) {
    case 'daily': return `${at} * * *`
    case 'weekdays': return `${at} * * 1-5`
    case 'weekly': return `${at} * * ${spec.day}`
    default: return `${at} ${spec.day} * *`
  }
}

const pad = (n: number): string => String(n).padStart(2, '0')
const clock = (hour: string, minute: string): string | null =>
  Number(hour) < 24 && Number(minute) < 60 ? `${pad(Number(hour))}:${pad(Number(minute))}` : null

function fromCron(expr: string): ScheduleSpec {
  const match = /^(\d{1,2}) (\d{1,2}) (\*|\d{1,2}) \* (\*|1-5|[0-6])$/.exec(expr.trim())
  const [, minute, hour, dom, dow] = match ?? []
  const at = match ? clock(hour!, minute!) : null
  if (at) {
    if (dom === '*' && dow === '*') return { kind: 'daily', time: at }
    if (dom === '*' && dow === '1-5') return { kind: 'weekdays', time: at }
    if (dom === '*' && dow !== '*') return { kind: 'weekly', day: Number(dow), time: at }
  }
  const monthly = /^(\d{1,2}) (\d{1,2}) (\d{1,2}) \* \*$/.exec(expr.trim())
  const monthlyAt = monthly ? clock(monthly[2]!, monthly[1]!) : null
  const day = monthly ? Number(monthly[3]) : 0
  if (monthlyAt && day >= 1 && day <= 31) return { kind: 'monthly', day, time: monthlyAt }
  return { kind: 'cron', expr: expr.trim() }
}

/** Best-effort reverse of `toHermesSchedule` for a stored job; unrecognised shapes stay `cron`. */
export function fromHermesSchedule(raw: HermesScheduleRaw, timezone: string): ScheduleSpec {
  if (raw.kind === 'interval') {
    const minutes = Math.max(1, Math.round(raw.minutes ?? 1))
    if (minutes % MINUTES.d === 0) return { kind: 'every', amount: minutes / MINUTES.d, unit: 'd' }
    if (minutes % MINUTES.h === 0) return { kind: 'every', amount: minutes / MINUTES.h, unit: 'h' }
    return { kind: 'every', amount: minutes, unit: 'm' }
  }
  if (raw.kind === 'once') {
    const at = DateTime.fromISO(raw.run_at ?? '', { zone: timezone, setZone: false })
    return at.isValid ? { kind: 'once_at', at: at.toFormat(AT_FORMAT) } : { kind: 'cron', expr: raw.run_at ?? '' }
  }
  return fromCron(raw.expr ?? '')
}

/** The next `count` run times (ms) of a schedule as seen from `now`, in `timezone`. */
export function previewRuns(spec: ScheduleSpec, timezone: string, now: number, count = 3): number[] {
  if (!IANAZone.isValidZone(timezone)) throw invalid(`unknown time zone '${timezone}'`)
  switch (spec.kind) {
    case 'once_in': return [now + spec.amount * MINUTES[spec.unit] * MS_PER_MINUTE]
    case 'every': return Array.from({ length: count }, (_, i) => now + (i + 1) * spec.amount * MINUTES[spec.unit] * MS_PER_MINUTE)
    case 'once_at': return [onceAt(spec.at, timezone, now)]
    default: return cronRuns(toHermesSchedule(spec, timezone), timezone, now, count)
  }
}

function onceAt(at: string, timezone: string, now: number): number {
  const date = DateTime.fromFormat(at, AT_FORMAT, { zone: timezone })
  if (!date.isValid) throw invalid(`invalid date and time '${at}'`)
  if (date.toMillis() <= now) throw new ScheduleError('in_past', 'that time has already passed')
  return date.toMillis()
}

function cronRuns(expr: string, timezone: string, now: number, count: number): number[] {
  try {
    return CronExpressionParser.parse(expr, { currentDate: new Date(now), tz: timezone }).take(count).map(d => d.getTime())
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : 'invalid cron expression')
  }
}
