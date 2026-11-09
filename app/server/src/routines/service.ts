import { HermesRestError } from '../hermes/errors.js'
import type { HermesRest } from '../hermes/rest-client.js'
import { log } from '../log.js'
import { TRIGGER_JOB_RE, type TriggerRun } from '../triggers/types.js'
import { createBody, isPausedJob, jobKey, jobPath, jobSchema, type RoutineInput, type RoutineView, routineBody, routineUpdates, runOf, type RunView, runSchema, TRIGGER_ONLY_REASON, triggerRunView, viewOf } from './mapping.js'
import { markTriggerOnly, runNow, type RunNowContext } from './run-now.js'

export type { RoutineInput, RoutineView, RunView } from './mapping.js'

export interface RoutineService {
  list(bot: string): Promise<RoutineView[]>
  create(bot: string, input: RoutineInput): Promise<RoutineView>
  update(bot: string, id: string, input: RoutineInput): Promise<RoutineView>
  pause(bot: string, id: string): Promise<RoutineView>
  resume(bot: string, id: string): Promise<RoutineView>
  remove(bot: string, id: string): Promise<void>
  runNow(bot: string, id: string): Promise<'started' | 'already_running' | 'finished'>
  runs(bot: string, id: string, limit?: number): Promise<RunView[]>
}

export interface RoutineDeps {
  readonly rest: HermesRest
  now(): number
  /** Trigger events of one routine that have a run, merged into its history. */
  readonly triggerRuns?: (bot: string, routineId: string) => readonly TriggerRun[]
}

const DEFAULT_RUNS = 20

function parseJob(ctx: RunNowContext, bot: string, raw: unknown, warn = true, hint = false): RoutineView | null {
  const parsed = jobSchema.safeParse(raw)
  if (!parsed.success) {
    if (warn) log.warn('skipping unparseable cron job', { bot, issue: parsed.error.issues[0]?.message ?? 'invalid' })
    return null
  }
  const k = jobKey(bot, parsed.data.id)
  return viewOf(bot, parsed.data, ctx.running.has(k), ctx.restorePause.has(k), hint || ctx.triggerOnly.has(k))
}

/** The job a write answered with; when the reply is not a job, read it back. */
async function jobFrom(ctx: RunNowContext, bot: string, id: string, reply: unknown): Promise<RoutineView> {
  const view = parseJob(ctx, bot, reply, false) ?? parseJob(ctx, bot, await ctx.rest.request('GET', jobPath(id), { query: { profile: bot } }))
  if (!view) throw new HermesRestError(502, 'unexpected cron job reply')
  return view
}

/** Rows of this bot's store; a row annotated with another profile is not ours. */
function ownRows(reply: unknown, bot: string): unknown[] {
  const rows = Array.isArray(reply) ? reply : ((reply as { jobs?: unknown[] } | null)?.jobs ?? [])
  return rows.filter(row => {
    const r = (row ?? {}) as { profile?: unknown; profile_name?: unknown }
    const owner = r.profile ?? r.profile_name
    return owner === undefined || owner === null || owner === bot
  })
}

async function listRoutines(ctx: RunNowContext, bot: string): Promise<RoutineView[]> {
  const reply = await ctx.rest.request<unknown>('GET', '/api/cron/jobs', { query: { profile: bot } })
  return ownRows(reply, bot).filter(row => !TRIGGER_JOB_RE.test(String((row as { name?: unknown } | null)?.name ?? ''))).map(row => parseJob(ctx, bot, row)).filter((view): view is RoutineView => view !== null)
}

async function listRuns(ctx: RunNowContext, bot: string, id: string, limit: number, triggerRuns: RoutineDeps['triggerRuns']): Promise<RunView[]> {
  const reply = await ctx.rest.request<{ runs?: unknown[] }>('GET', `${jobPath(id)}/runs`, { query: { profile: bot, limit: String(limit) } })
  const own = (reply.runs ?? []).flatMap(row => {
    const parsed = runSchema.safeParse(row)
    const run = parsed.success ? runOf(parsed.data) : null
    if (!run) log.warn('skipping unparseable cron run', { bot, jobId: id })
    return run ? [run] : []
  })
  // The limit applies after merging, so newer trigger runs are not cut off by older Hermes rows.
  const fromTriggers = (triggerRuns?.(bot, id) ?? []).map(triggerRunView)
  if (fromTriggers.length === 0) return own
  return [...own, ...fromTriggers].sort((a, b) => b.startedAt - a.startedAt).slice(0, limit)
}

/** The mode flips after the field changes: to event-only pause + marker, back to a schedule resume. */
async function switchMode(ctx: RunNowContext, bot: string, id: string, toTriggered: boolean): Promise<void> {
  if (toTriggered) await markTriggerOnly(ctx.rest, bot, id)
  else await ctx.rest.request('POST', `${jobPath(id)}/resume`, { query: { profile: bot } })
}

/**
 * Edit: read the stored job and send only what changed; with no change, just return it. An absent
 * `runs` keeps the current mode. A mode switch is the user's choice, so it replaces any pending
 * Run-now restore: while a run is in flight, a switch to event-only makes the settle re-pause with the
 * marker, and a switch back makes it leave the routine alone.
 */
async function updateRoutine(ctx: RunNowContext, bot: string, id: string, input: RoutineInput, userChoice: (bot: string, id: string) => void): Promise<RoutineView> {
  const raw = await ctx.rest.request<unknown>('GET', jobPath(id), { query: { profile: bot } })
  const current = jobSchema.safeParse(raw)
  if (!current.success) return jobFrom(ctx, bot, id, await ctx.rest.request('PUT', jobPath(id), { query: { profile: bot }, body: { updates: routineBody(bot, input) } }))
  const k = jobKey(bot, id)
  // Mid-run Hermes has already un-paused and un-marked the job, so Crew's own record counts too.
  const wasTriggered = (current.data.paused_reason === TRIGGER_ONLY_REASON && isPausedJob(current.data)) || ctx.triggerOnly.has(k)
  const toTriggered = input.runs === undefined ? wasTriggered : input.runs === 'triggered'
  const updates = routineUpdates(bot, { ...input, runs: toTriggered ? 'triggered' : 'schedule' }, current.data)
  const put = (): Promise<unknown> => (Object.keys(updates).length === 0 ? Promise.resolve(raw) : ctx.rest.request('PUT', jobPath(id), { query: { profile: bot }, body: { updates } }))
  if (wasTriggered === toTriggered) return jobFrom(ctx, bot, id, await put())
  const inFlight = ctx.running.has(k)
  userChoice(bot, id)
  // To event-only: pause and mark first, so a failure never leaves the routine active on the yearly schedule.
  // Back to a schedule: change the fields first, so a failure never leaves it resumed on the yearly schedule.
  if (toTriggered) {
    await switchMode(ctx, bot, id, true)
    await put()
  } else {
    await put()
    await switchMode(ctx, bot, id, false)
  }
  if (toTriggered && inFlight) {
    ctx.restorePause.add(k)
    ctx.triggerOnly.add(k)
  }
  return jobFrom(ctx, bot, id, undefined)
}

/** Routines are Hermes cron jobs in the bot's own store (`?profile=<bot>`), named `[bot:<bot>] <title>`. */
export function createRoutineService(deps: RoutineDeps): RoutineService {
  const ctx: RunNowContext = { rest: deps.rest, running: new Set(), restorePause: new Set(), triggerOnly: new Set() }
  const query = (bot: string) => ({ query: { profile: bot } })
  /** A user pause/resume/remove while a paused routine runs wins over the automatic re-pause. */
  const userChoice = (bot: string, id: string): void => {
    ctx.restorePause.delete(jobKey(bot, id))
    ctx.triggerOnly.delete(jobKey(bot, id))
  }
  const toggle = async (bot: string, id: string, action: 'pause' | 'resume'): Promise<RoutineView> => {
    userChoice(bot, id)
    return jobFrom(ctx, bot, id, await ctx.rest.request('POST', `${jobPath(id)}/${action}`, query(bot)))
  }
  return {
    list: bot => listRoutines(ctx, bot),
    create: async (bot, input) => {
      const view = parseJob(ctx, bot, await ctx.rest.request('POST', '/api/cron/jobs', { ...query(bot), body: createBody(bot, input) }))
      if (!view) throw new HermesRestError(502, 'unexpected cron job reply')
      return view
    },
    update: (bot, id, input) => updateRoutine(ctx, bot, id, input, userChoice),
    pause: (bot, id) => toggle(bot, id, 'pause'),
    resume: (bot, id) => toggle(bot, id, 'resume'),
    remove: async (bot, id) => {
      userChoice(bot, id)
      await ctx.rest.request('DELETE', jobPath(id), query(bot))
    },
    runNow: (bot, id) => runNow(ctx, bot, id),
    runs: (bot, id, limit = DEFAULT_RUNS) => listRuns(ctx, bot, id, limit, deps.triggerRuns)
  }
}
