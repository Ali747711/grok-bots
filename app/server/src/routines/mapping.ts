import { z } from 'zod'

import { fromHermesSchedule, type ScheduleSpec, toHermesSchedule } from './schedule.js'

const TAG_RE = /^\[bot:[a-z0-9][a-z0-9_-]*\]\s*/i
const SYNTHESIZED_RE = /^(COMPLETED|FAILED|CANCELLED|MISSED) · (.*)$/s
const LAST_STATUSES = ['ok', 'error', 'delivery_failed', 'blocked_config'] as const

export interface RoutineInput {
  readonly title: string
  readonly instruction: string
  readonly schedule: ScheduleSpec
  readonly timezone: string
  readonly deliverToChat: boolean
}

export interface RoutineView {
  readonly id: string
  readonly bot: string
  readonly title: string
  readonly instruction: string
  readonly schedule: ScheduleSpec
  readonly scheduleText: string
  readonly timezone: string | null
  readonly deliverToChat: boolean
  readonly enabled: boolean
  readonly nextRunAt: number | null
  readonly lastRunAt: number | null
  readonly lastStatus: (typeof LAST_STATUSES)[number] | null
  readonly lastError: string | null
  readonly running: boolean
  /** Hermes job state: scheduled | paused | completed | error | ... */
  readonly state: string | null
  /** A terminal job (`completed` or `error`, Hermes `is_terminal_job`): it will not fire again. */
  readonly finished: boolean
}

export interface RunView {
  readonly id: string
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'missed'
  readonly startedAt: number
  readonly endedAt: number | null
  readonly title: string
  readonly sessionId: string | null
  readonly error: string | null
}

// Unknown fields pass through and every field but `id` may be missing or null, so a Hermes change
// degrades a field to null instead of crashing (the live store had no samples to copy from).
const str = z.string().nullish()
export const jobSchema = z.object({
  id: z.string().min(1),
  name: str,
  prompt: str,
  profile: str,
  profile_name: str,
  enabled: z.boolean().nullish(),
  state: str,
  /** Hermes attaches the newest claimed/running execution to every listed job (null when idle). */
  live_execution: z.unknown().optional(),
  deliver: str,
  timezone: str,
  schedule: z.object({ kind: z.enum(['once', 'interval', 'cron']).nullish(), run_at: str, minutes: z.number().nullish(), expr: str, display: str }).passthrough().nullish(),
  schedule_display: str,
  next_run_at: z.unknown().optional(),
  last_run_at: z.unknown().optional(),
  last_status: str,
  last_error: str,
  last_delivery_error: str,
  last_fire_error: str
}).passthrough()
type Job = z.infer<typeof jobSchema>

export const runSchema = z.object({
  id: z.string().nullish(),
  cron_execution_id: z.string().nullish(),
  source: str,
  title: str,
  started_at: z.number().nullish(),
  ended_at: z.number().nullish(),
  is_active: z.boolean().nullish()
}).passthrough()

export const enc = encodeURIComponent
const serverZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone

/** ISO string (or epoch seconds/ms) to ms; anything else is null. */
function toMs(value: unknown): number | null {
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    return Number.isNaN(ms) ? null : ms
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value
  return null
}

export const isFinished = (state: string | null | undefined): boolean => state === 'completed' || state === 'error'

export function viewOf(bot: string, job: Job, running: boolean, repausing: boolean): RoutineView {
  const sched = job.schedule
  const zone = job.timezone || serverZone()
  const spec: ScheduleSpec = sched?.kind
    ? fromHermesSchedule({ kind: sched.kind, run_at: sched.run_at, minutes: sched.minutes, expr: sched.expr }, zone)
    : { kind: 'cron', expr: job.schedule_display ?? '' }
  const status = LAST_STATUSES.find(s => s === job.last_status) ?? null
  return {
    id: job.id,
    bot,
    title: (job.name ?? '').replace(TAG_RE, ''),
    instruction: job.prompt ?? '',
    schedule: spec,
    scheduleText: sched?.display ?? job.schedule_display ?? toHermesSchedule(spec, zone),
    timezone: job.timezone ?? null,
    deliverToChat: (job.deliver ?? '').startsWith('bot-chat'),
    // Hermes re-enables a paused job when it is triggered; Crew re-pauses it afterwards, so show the user's state.
    enabled: job.enabled !== false && !repausing,
    nextRunAt: toMs(job.next_run_at),
    lastRunAt: toMs(job.last_run_at),
    lastStatus: status,
    lastError: job.last_error || job.last_delivery_error || job.last_fire_error || null,
    running: running || Boolean(job.live_execution),
    state: job.state ?? null,
    finished: isFinished(job.state)
  }
}

export function runOf(row: z.infer<typeof runSchema>): RunView | null {
  const id = row.id ?? row.cron_execution_id
  if (!id) return null
  const startedAt = toMs(row.started_at) ?? 0
  const endedAt = toMs(row.ended_at)
  const title = row.title ?? ''
  const synthesized = SYNTHESIZED_RE.exec(title)
  const status = synthesized?.[1]?.toLowerCase() as RunView['status'] | undefined
  // Only `source: 'cron'` rows are real sessions; `cron_output:<job>:exec:<n>` ids have no transcript.
  const sessionId = row.source === 'cron' ? (row.id ?? null) : null
  if (status && status !== 'completed') return { id, status, startedAt, endedAt, title, sessionId, error: synthesized![2] || null }
  const active = endedAt === null && row.is_active === true
  return { id, status: active ? 'running' : 'completed', startedAt, endedAt, title: synthesized ? synthesized[2]! : title, sessionId, error: null }
}

export function routineBody(bot: string, input: RoutineInput): Record<string, unknown> {
  return {
    name: `[bot:${bot}] ${input.title}`,
    prompt: input.instruction,
    schedule: toHermesSchedule(input.schedule, input.timezone),
    timezone: input.timezone,
    deliver: input.deliverToChat ? 'bot-chat' : 'local'
  }
}


export const jobKey = (bot: string, id: string): string => `${bot}/${id}`
export const jobPath = (id: string): string => `/api/cron/jobs/${enc(id)}`
