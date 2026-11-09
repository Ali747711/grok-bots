import { HermesRestError } from '../hermes/errors.js'
import type { HermesRest } from '../hermes/rest-client.js'
import { log } from '../log.js'
import { isFinished, isPausedJob, jobKey, jobPath, jobSchema, TRIGGER_ONLY_REASON } from './mapping.js'

const RUN_NOW_WAIT_MS = 3_000

export interface RunNowContext {
  readonly rest: HermesRest
  /** `<bot>/<job id>` of triggers whose request has not settled yet. */
  readonly running: Set<string>
  /** Paused routines being run now: Hermes un-pauses on trigger, so pause them again when it ends. */
  readonly restorePause: Set<string>
  /** Of those, the routines that were trigger-only: Hermes clears the marker on a force-run, so it is put back. */
  readonly triggerOnly: Set<string>
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200)

/**
 * A failed read propagates: without knowing the state, triggering could un-pause the routine for good.
 * A finished job is never "paused" (re-pausing a terminal record would make it impossible to resume).
 */
async function readState(ctx: RunNowContext, bot: string, id: string): Promise<{ paused: boolean; finished: boolean; triggerOnly: boolean }> {
  const job = jobSchema.safeParse(await ctx.rest.request<unknown>('GET', jobPath(id), { query: { profile: bot } }))
  if (!job.success) return { paused: false, finished: false, triggerOnly: false }
  const finished = isFinished(job.data.state)
  const paused = !finished && isPausedJob(job.data)
  return { finished, paused, triggerOnly: paused && job.data.paused_reason === TRIGGER_ONLY_REASON }
}

/** Pause, then write Crew's marker (a pause alone leaves no reason, and Hermes clears it on every force-run). */
export async function markTriggerOnly(rest: HermesRest, bot: string, id: string): Promise<void> {
  await rest.request('POST', `${jobPath(id)}/pause`, { query: { profile: bot } })
  await rest.request('PUT', jobPath(id), { query: { profile: bot }, body: { updates: { paused_reason: TRIGGER_ONLY_REASON } } })
}

async function repause(ctx: RunNowContext, bot: string, id: string): Promise<void> {
  const k = jobKey(bot, id)
  const restoreMarker = ctx.triggerOnly.delete(k)
  if (!ctx.restorePause.delete(k)) return
  try {
    await ctx.rest.request('POST', `${jobPath(id)}/pause`, { query: { profile: bot } })
  } catch (error) {
    log.warn('re-pause after run now failed', { jobId: id, error: reason(error) })
    return
  }
  if (!restoreMarker) return
  try {
    await ctx.rest.request('PUT', jobPath(id), { query: { profile: bot }, body: { updates: { paused_reason: TRIGGER_ONLY_REASON } } })
  } catch (error) {
    log.warn('trigger-only marker restore failed', { jobId: id, error: reason(error) })
  }
}

/**
 * Start the trigger (a synchronous Hermes call that waits for the whole run, so no Crew timeout) and
 * report after at most 3 s. The id stays in `running` until the request settles; a paused routine is
 * paused again then, because Hermes enables a job when it triggers it. A job that already finished
 * (a one-time routine that ran) is not triggered at all.
 */
export async function runNow(ctx: RunNowContext, bot: string, id: string): Promise<'started' | 'already_running' | 'finished'> {
  const k = jobKey(bot, id)
  if (ctx.running.has(k)) return 'already_running'
  ctx.running.add(k)
  try {
    const state = await readState(ctx, bot, id)
    if (state.finished) {
      ctx.running.delete(k)
      return 'finished'
    }
    if (state.paused) ctx.restorePause.add(k)
    if (state.triggerOnly) ctx.triggerOnly.add(k)
  } catch (error) {
    ctx.running.delete(k)
    throw error
  }
  let detached = false
  const settled = ctx.rest.request('POST', `${jobPath(id)}/trigger`, { query: { profile: bot }, timeoutMs: 0 })
    .then(() => null, (error: unknown) => {
      if (detached) log.info('run-now request ended', { jobId: id, reason: reason(error).slice(0, 120) })
      return error
    })
    .then(async outcome => {
      ctx.running.delete(k)
      await repause(ctx, bot, id)
      return outcome
    })
  let timer: NodeJS.Timeout | undefined
  const waited = new Promise<'pending'>(resolve => { timer = setTimeout(() => resolve('pending'), RUN_NOW_WAIT_MS) })
  try {
    const first = await Promise.race([settled, waited])
    if (first === 'pending') detached = true
    if (first === 'pending' || first === null) return 'started'
    if (first instanceof HermesRestError && first.status === 409) return 'already_running'
    throw first
  } finally {
    clearTimeout(timer)
  }
}
