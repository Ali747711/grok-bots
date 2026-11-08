import { HermesRestError } from '../hermes/errors.js'
import type { HermesRest } from '../hermes/rest-client.js'
import { log } from '../log.js'
import { jobKey, jobPath, jobSchema, type RoutineInput, type RoutineView, routineBody, runOf, type RunView, runSchema, viewOf } from './mapping.js'
import { runNow, type RunNowContext } from './run-now.js'

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
}

const DEFAULT_RUNS = 20

function parseJob(ctx: RunNowContext, bot: string, raw: unknown, warn = true): RoutineView | null {
  const parsed = jobSchema.safeParse(raw)
  if (!parsed.success) {
    if (warn) log.warn('skipping unparseable cron job', { bot, issue: parsed.error.issues[0]?.message ?? 'invalid' })
    return null
  }
  const k = jobKey(bot, parsed.data.id)
  return viewOf(bot, parsed.data, ctx.running.has(k), ctx.restorePause.has(k))
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
  return ownRows(reply, bot).map(row => parseJob(ctx, bot, row)).filter((view): view is RoutineView => view !== null)
}

async function listRuns(ctx: RunNowContext, bot: string, id: string, limit: number): Promise<RunView[]> {
  const reply = await ctx.rest.request<{ runs?: unknown[] }>('GET', `${jobPath(id)}/runs`, { query: { profile: bot, limit: String(limit) } })
  return (reply.runs ?? []).flatMap(row => {
    const parsed = runSchema.safeParse(row)
    const run = parsed.success ? runOf(parsed.data) : null
    if (!run) log.warn('skipping unparseable cron run', { bot, jobId: id })
    return run ? [run] : []
  })
}

/** Routines are Hermes cron jobs in the bot's own store (`?profile=<bot>`), named `[bot:<bot>] <title>`. */
export function createRoutineService(deps: RoutineDeps): RoutineService {
  const ctx: RunNowContext = { rest: deps.rest, running: new Set(), restorePause: new Set() }
  const query = (bot: string) => ({ query: { profile: bot } })
  /** A user pause/resume/remove while a paused routine runs wins over the automatic re-pause. */
  const userChoice = (bot: string, id: string): void => { ctx.restorePause.delete(jobKey(bot, id)) }
  const toggle = async (bot: string, id: string, action: 'pause' | 'resume'): Promise<RoutineView> => {
    userChoice(bot, id)
    return jobFrom(ctx, bot, id, await ctx.rest.request('POST', `${jobPath(id)}/${action}`, query(bot)))
  }
  return {
    list: bot => listRoutines(ctx, bot),
    create: async (bot, input) => {
      const view = parseJob(ctx, bot, await ctx.rest.request('POST', '/api/cron/jobs', { ...query(bot), body: routineBody(bot, input) }))
      if (!view) throw new HermesRestError(502, 'unexpected cron job reply')
      return view
    },
    update: async (bot, id, input) => jobFrom(ctx, bot, id, await ctx.rest.request('PUT', jobPath(id), { ...query(bot), body: { updates: routineBody(bot, input) } })),
    pause: (bot, id) => toggle(bot, id, 'pause'),
    resume: (bot, id) => toggle(bot, id, 'resume'),
    remove: async (bot, id) => {
      userChoice(bot, id)
      await ctx.rest.request('DELETE', jobPath(id), query(bot))
    },
    runNow: (bot, id) => runNow(ctx, bot, id),
    runs: (bot, id, limit = DEFAULT_RUNS) => listRuns(ctx, bot, id, limit)
  }
}
