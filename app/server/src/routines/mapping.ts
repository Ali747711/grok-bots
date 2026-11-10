import { z } from 'zod'

import type { TriggerRun } from '../triggers/types.js'
import { fromHermesSchedule, type ScheduleSpec, toHermesSchedule } from './schedule.js'

export const TRIGGER_ONLY_REASON = 'crew:trigger-only'
/** A yearly schedule that never matters: the routine only runs when a trigger fires it. */
export const TRIGGER_ONLY_CRON = '0 3 1 1 *'
const TAG_RE = /^\[bot:[a-z0-9][a-z0-9_-]*\]\s*/i
const SYNTHESIZED_RE = /^(COMPLETED|FAILED|CANCELLED|MISSED) · (.*)$/s
const LAST_STATUSES = ['ok', 'error', 'delivery_failed', 'blocked_config'] as const

export interface RoutineInput {
  readonly title: string
  readonly instruction: string
  readonly schedule: ScheduleSpec
  readonly timezone: string
  readonly deliverToChat: boolean
  /** Edit only: the user changed the zone select, so the zone is sent even if the schedule is unchanged. */
  readonly timezoneChanged?: boolean
  /** Absent means a schedule. When `triggered`, `schedule` is ignored. */
  readonly runs?: 'schedule' | 'triggered'
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
  /** Runs only when a trigger fires it (paused with Crew's marker). */
  readonly triggerOnly: boolean
}

export interface RunView {
  readonly id: string
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'missed'
  readonly startedAt: number
  readonly endedAt: number | null
  readonly title: string
  readonly sessionId: string | null
  readonly error: string | null
  /** Set on rows that Crew built from a trigger event. */
  readonly trigger?: { readonly id: string; readonly name: string; readonly eventType: string }
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
  paused_reason: str,
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
export type Job = z.infer<typeof jobSchema>

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

/** The job's schedule as a form-friendly spec; a one-shot is shown in the job's zone (else the server's). */
export function scheduleOf(job: Job): ScheduleSpec {
  const sched = job.schedule
  if (!sched?.kind) return { kind: 'cron', expr: job.schedule_display ?? '' }
  return fromHermesSchedule({ kind: sched.kind, run_at: sched.run_at, minutes: sched.minutes, expr: sched.expr }, job.timezone || serverZone())
}

/** The routine's own title: the name without the `[bot:<name>]` tag. */
export const titleOf = (job: Job): string => (job.name ?? '').replace(TAG_RE, '')
export const isPausedJob = (job: Job): boolean => job.enabled === false || job.state === 'paused'

/** What Hermes is told: a triggered routine always carries the never-matching yearly schedule. */
export const effectiveSchedule = (input: RoutineInput): ScheduleSpec => (input.runs === 'triggered' ? { kind: 'cron', expr: TRIGGER_ONLY_CRON } : input.schedule)

/**
 * `triggerOnlyHint`: Hermes clears the marker while it force-runs a paused job, so Crew keeps
 * showing the routine as trigger-only until it has put the marker back.
 */
export function viewOf(bot: string, job: Job, running: boolean, repausing: boolean, triggerOnlyHint = false): RoutineView {
  const sched = job.schedule
  const zone = job.timezone || serverZone()
  const spec = scheduleOf(job)
  const status = LAST_STATUSES.find(s => s === job.last_status) ?? null
  return {
    id: job.id,
    bot,
    title: titleOf(job),
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
    finished: isFinished(job.state),
    triggerOnly: job.paused_reason === TRIGGER_ONLY_REASON || triggerOnlyHint
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
    schedule: toHermesSchedule(effectiveSchedule(input), input.timezone),
    timezone: input.timezone,
    deliver: input.deliverToChat ? 'bot-chat' : 'local'
  }
}

/** Create body: an event-only routine starts paused with Crew's marker. */
export function createBody(bot: string, input: RoutineInput): Record<string, unknown> {
  return { ...routineBody(bot, input), ...(input.runs === 'triggered' ? { paused: true, paused_reason: TRIGGER_ONLY_REASON } : {}) }
}

/** A trigger event shown as a run row; `finished` is a completed run, `started` one still going. */
export function triggerRunView({ triggerId, triggerName, event }: TriggerRun): RunView {
  const status: RunView['status'] = event.outcome === 'finished' ? 'completed' : event.outcome === 'started' ? 'running' : 'failed'
  return {
    id: `trigger:${event.id}`,
    status,
    startedAt: event.at,
    endedAt: event.endedAt,
    title: `${triggerName} · ${event.eventType}`,
    sessionId: event.runId,
    error: event.detail,
    trigger: { id: triggerId, name: triggerName, eventType: event.eventType }
  }
}

export const jobKey = (bot: string, id: string): string => `${bot}/${id}`
export const jobPath = (id: string): string => `/api/cron/jobs/${enc(id)}`

/**
 * The `updates` of an edit: only the fields whose value differs from the stored job. Sending `schedule`
 * makes Hermes recompute the next run (an interval re-anchors to now), and a `timezone` would pin a zone
 * the job never had, so both go only when the schedule moved or the user changed the zone.
 */
export function routineUpdates(bot: string, input: RoutineInput, current: Job): Record<string, unknown> {
  const full = routineBody(bot, input)
  const scheduleChanged = JSON.stringify(effectiveSchedule(input)) !== JSON.stringify(scheduleOf(current))
  const sendZone = input.timezoneChanged === true || (scheduleChanged && input.timezone !== (current.timezone ?? null))
  const changed: Record<string, unknown> = {}
  if (full.name !== current.name) changed.name = full.name
  if (full.prompt !== current.prompt) changed.prompt = full.prompt
  if (input.deliverToChat !== (current.deliver ?? '').startsWith('bot-chat')) changed.deliver = full.deliver
  if (scheduleChanged) changed.schedule = full.schedule
  if (sendZone) changed.timezone = full.timezone
  return changed
}
