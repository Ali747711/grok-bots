import { z } from 'zod'

import { HermesRestError } from '../hermes/errors.js'
import type { HermesRest } from '../hermes/rest-client.js'
import { log } from '../log.js'
import { fromHermesSchedule, type ScheduleSpec, toHermesSchedule } from './schedule.js'

const RUN_NOW_WAIT_MS = 3_000
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

export interface RoutineService {
  list(bot: string): Promise<RoutineView[]>
  create(bot: string, input: RoutineInput): Promise<RoutineView>
  update(bot: string, id: string, input: RoutineInput): Promise<RoutineView>
  pause(bot: string, id: string): Promise<RoutineView>
  resume(bot: string, id: string): Promise<RoutineView>
  remove(bot: string, id: string): Promise<void>
  runNow(bot: string, id: string): Promise<'started' | 'already_running'>
  runs(bot: string, id: string, limit?: number): Promise<RunView[]>
}

export interface RoutineDeps {
  readonly rest: HermesRest
  now(): number
}

// Unknown fields pass through and every field but `id` may be missing or null, so a Hermes change
// degrades a field to null instead of crashing (the live store had no samples to copy from).
const str = z.string().nullish()
const jobSchema = z.object({
  id: z.string().min(1),
  name: str,
  prompt: str,
  profile: str,
  profile_name: str,
  enabled: z.boolean().nullish(),
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

const runSchema = z.object({
  id: z.string().nullish(),
  cron_execution_id: z.string().nullish(),
  source: str,
  title: str,
  started_at: z.number().nullish(),
  ended_at: z.number().nullish(),
  is_active: z.boolean().nullish()
}).passthrough()

const enc = encodeURIComponent
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

function viewOf(bot: string, job: Job, running: boolean): RoutineView {
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
    scheduleText: sched?.display ?? job.schedule_display ?? toHermesSchedule(spec),
    timezone: job.timezone ?? null,
    deliverToChat: (job.deliver ?? '').startsWith('bot-chat'),
    enabled: job.enabled !== false,
    nextRunAt: toMs(job.next_run_at),
    lastRunAt: toMs(job.last_run_at),
    lastStatus: status,
    lastError: job.last_error || job.last_delivery_error || job.last_fire_error || null,
    running
  }
}

function runOf(row: z.infer<typeof runSchema>): RunView | null {
  const id = row.id ?? row.cron_execution_id
  if (!id) return null
  const startedAt = toMs(row.started_at) ?? 0
  const endedAt = toMs(row.ended_at)
  const title = row.title ?? ''
  const synthesized = SYNTHESIZED_RE.exec(title)
  const status = synthesized?.[1]?.toLowerCase() as RunView['status'] | undefined
  if (status && status !== 'completed') {
    return { id, status, startedAt, endedAt, title, sessionId: null, error: synthesized![2] || null }
  }
  const active = endedAt === null && row.is_active === true
  return { id, status: active ? 'running' : 'completed', startedAt, endedAt, title: synthesized ? synthesized[2]! : title, sessionId: row.id ?? null, error: null }
}

function body(bot: string, input: RoutineInput): Record<string, unknown> {
  return {
    name: `[bot:${bot}] ${input.title}`,
    prompt: input.instruction,
    schedule: toHermesSchedule(input.schedule),
    timezone: input.timezone,
    deliver: input.deliverToChat ? 'bot-chat' : 'local'
  }
}

/** Routines are Hermes cron jobs in the bot's own store (`?profile=<bot>`), named `[bot:<bot>] <title>`. */
export function createRoutineService(deps: RoutineDeps): RoutineService {
  const { rest } = deps
  /** `<bot>/<job id>` of triggers whose request has not settled yet. */
  const running = new Set<string>()
  const key = (bot: string, id: string): string => `${bot}/${id}`
  const jobPath = (id: string): string => `/api/cron/jobs/${enc(id)}`

  function parseJob(bot: string, raw: unknown, warn = true): RoutineView | null {
    const parsed = jobSchema.safeParse(raw)
    if (!parsed.success) {
      if (warn) log.warn('skipping unparseable cron job', { bot, issue: parsed.error.issues[0]?.message ?? 'invalid' })
      return null
    }
    return viewOf(bot, parsed.data, running.has(key(bot, parsed.data.id)))
  }

  async function oneJob(bot: string, id: string, reply: unknown): Promise<RoutineView> {
    const direct = parseJob(bot, reply, false)
    if (direct) return direct
    const fetched = parseJob(bot, await rest.request('GET', jobPath(id), { query: { profile: bot } }))
    if (!fetched) throw new HermesRestError(502, 'unexpected cron job reply')
    return fetched
  }

  const post = (bot: string, id: string, action: 'pause' | 'resume') =>
    rest.request('POST', `${jobPath(id)}/${action}`, { query: { profile: bot } }).then(reply => oneJob(bot, id, reply))

  async function runNow(bot: string, id: string): Promise<'started' | 'already_running'> {
    const k = key(bot, id)
    if (running.has(k)) return 'already_running'
    running.add(k)
    let detached = false
    const settled = rest.request('POST', `${jobPath(id)}/trigger`, { query: { profile: bot }, timeoutMs: 0 }).then(
      () => { running.delete(k); return null },
      (error: unknown) => {
        running.delete(k)
        if (detached) log.info('run-now request ended', { jobId: id, reason: (error instanceof Error ? error.message : String(error)).slice(0, 120) })
        return error
      }
    )
    let timer: NodeJS.Timeout | undefined
    const waited = new Promise<'pending'>(resolve => { timer = setTimeout(() => resolve('pending'), RUN_NOW_WAIT_MS) })
    try {
      const first = await Promise.race([settled, waited])
      if (first === 'pending') {
        detached = true
        return 'started'
      }
      if (first === null) return 'started'
      if (first instanceof HermesRestError && first.status === 409) return 'already_running'
      throw first
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    list: async bot => {
      const reply = await rest.request<unknown>('GET', '/api/cron/jobs', { query: { profile: bot } })
      const rows = Array.isArray(reply) ? reply : ((reply as { jobs?: unknown[] } | null)?.jobs ?? [])
      const own = rows.filter(row => {
        const owner = (row as { profile?: unknown; profile_name?: unknown } | null)?.profile ?? (row as { profile_name?: unknown } | null)?.profile_name
        return owner === undefined || owner === null || owner === bot
      })
      return own.map(row => parseJob(bot, row)).filter((view): view is RoutineView => view !== null)
    },
    create: async (bot, input) => {
      const reply = await rest.request('POST', '/api/cron/jobs', { query: { profile: bot }, body: body(bot, input) })
      const view = parseJob(bot, reply)
      if (!view) throw new HermesRestError(502, 'unexpected cron job reply')
      return view
    },
    update: async (bot, id, input) => oneJob(bot, id, await rest.request('PUT', jobPath(id), { query: { profile: bot }, body: { updates: body(bot, input) } })),
    pause: (bot, id) => post(bot, id, 'pause'),
    resume: (bot, id) => post(bot, id, 'resume'),
    remove: async (bot, id) => {
      await rest.request('DELETE', jobPath(id), { query: { profile: bot } })
    },
    runNow,
    runs: async (bot, id, limit = 20) => {
      const reply = await rest.request<{ runs?: unknown[] }>('GET', `${jobPath(id)}/runs`, { query: { profile: bot, limit: String(limit) } })
      return (reply.runs ?? []).flatMap(row => {
        const parsed = runSchema.safeParse(row)
        const run = parsed.success ? runOf(parsed.data) : null
        if (!run) log.warn('skipping unparseable cron run', { bot, jobId: id })
        return run ? [run] : []
      })
    }
  }
}
