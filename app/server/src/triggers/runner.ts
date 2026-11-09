import { HermesRestError } from '../hermes/errors.js'
import type { HermesRest } from '../hermes/rest-client.js'
import { log } from '../log.js'
import { isPausedJob, jobPath, jobSchema, runOf, runSchema, TRIGGER_ONLY_REASON } from '../routines/mapping.js'
import { buildEventPrompt } from './event-prompt.js'
import type { Held, Limiter } from './limits.js'
import { outcomeOf, oneShotBody } from './one-shot.js'
import type { ParsedPayload } from './payload.js'
import type { TriggerStore } from './store.js'
import { cutDetail, type Trigger, type TriggerEvent, type TriggerOutcome } from './types.js'

export const POLL_MS = 5_000
export const MAX_POLL_MS = 30 * 60_000
const HOUR_MS = 3_600_000
const RECOVERY_SLACK_MS = 5_000

export interface EventInput {
  readonly eventId: string
  readonly at: number
  readonly deliveryId: string | null
  readonly eventType: string
  readonly action: string | null
  readonly payload: ParsedPayload
  /** Raw request text, a fallback for a JSON payload too deep to re-serialize. */
  readonly rawText?: string
}

export type StartError = 'too_many_events' | 'routine_paused' | 'routine_deleted' | 'hermes_refused' | 'hermes_offline'
export type StartResult =
  | { ok: true; event: TriggerEvent }
  | { ok: false; status: 409 | 410 | 429 | 502 | 503; error: StartError; event: TriggerEvent }

export interface TriggerRunner {
  start(trigger: Trigger, input: EventInput): Promise<StartResult>
  /** Call exactly once, before hooks are served. After a restart: re-adopt the limiter state from the log and poll every unfinished run. */
  resume(): void
  stop(): void
}

export interface RunnerDeps {
  readonly rest: HermesRest
  readonly store: TriggerStore
  readonly limiter: Limiter
  readonly now: () => number
  readonly pollMs?: number
  readonly maxPollMs?: number
}

interface Ref {
  readonly triggerId: string
  readonly bot: string
  readonly eventId: string
  readonly eventType: string
  readonly jobId: string
  readonly at: number
}

const short = (id: string): string => id.slice(0, 8)
const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 200)
const isStatus = (error: unknown, ...codes: number[]): boolean => error instanceof HermesRestError && codes.includes(error.status)

export function createTriggerRunner(deps: RunnerDeps): TriggerRunner {
  const { rest, store, limiter, now } = deps
  const pollMs = deps.pollMs ?? POLL_MS
  const maxPollMs = deps.maxPollMs ?? MAX_POLL_MS
  const held = new Map<string, Held>()
  const timers = new Set<NodeJS.Timeout>()
  let stopped = false

  /** Store writes reject when the file cannot be saved (memory keeps the change): log, never throw. */
  const safe = async <T>(what: string, work: Promise<T>): Promise<T | undefined> => {
    try {
      return await work
    } catch (error) {
      log.warn('trigger store write failed', { what, error: reason(error) })
      return undefined
    }
  }

  const query = (bot: string) => ({ query: { profile: bot } })

  async function deleteJob(ref: Ref): Promise<void> {
    try {
      await rest.request('DELETE', jobPath(ref.jobId), query(ref.bot))
    } catch (error) {
      log.warn('trigger one-shot delete failed', { trigger: short(ref.triggerId), error: reason(error) })
    }
  }

  async function finish(ref: Ref, outcome: TriggerOutcome, detail: string | null, runId: string | null, endedAt: number): Promise<void> {
    // The store applies the change in memory at once; the slot is free as soon as the outcome is recorded.
    const written = safe('patchEvent', store.patchEvent(ref.triggerId, ref.eventId, { outcome, detail, runId, endedAt }))
    held.get(ref.eventId)?.release(true)
    held.delete(ref.eventId)
    await written
  }

  async function latestRun(ref: Ref): Promise<{ sessionId: string | null; endedAt: number | null }> {
    try {
      const reply = await rest.request<{ runs?: unknown[] }>('GET', `${jobPath(ref.jobId)}/runs`, { query: { profile: ref.bot, limit: '5' } })
      const parsed = runSchema.safeParse(reply.runs?.[0])
      const run = parsed.success ? runOf(parsed.data) : null
      return { sessionId: run?.sessionId ?? null, endedAt: run?.endedAt ?? null }
    } catch (error) {
      log.info('trigger run lookup failed', { trigger: short(ref.triggerId), error: reason(error) })
      return { sessionId: null, endedAt: null }
    }
  }

  /** The job vanished (restart, manual delete): resolve from its run session if exactly one matches (R8). */
  async function recover(ref: Ref): Promise<void> {
    let sessionId: string | null = null
    try {
      const reply = await rest.request<{ sessions?: { id?: unknown; title?: unknown; started_at?: unknown }[] }>('GET', '/api/sessions', { query: { source: 'cron', profile: ref.bot, limit: '50' } })
      const prefix = `[trigger:${ref.triggerId}]`
      // A session another event already recorded cannot be this event's run (R8).
      const used = new Set(store.events(ref.triggerId).flatMap(e => (e.runId ? [e.runId] : [])))
      const matches = (reply.sessions ?? []).filter(s => {
        const startedMs = typeof s.started_at === 'number' ? (s.started_at < 1e12 ? s.started_at * 1000 : s.started_at) : 0
        return typeof s.id === 'string' && !used.has(s.id) && typeof s.title === 'string' && s.title.startsWith(prefix) && s.title.includes(` · ${ref.eventType}`) &&
          startedMs >= ref.at - RECOVERY_SLACK_MS && startedMs <= ref.at + maxPollMs
      })
      if (matches.length === 1) sessionId = String(matches[0]?.id)
    } catch (error) {
      log.info('trigger session recovery failed', { trigger: short(ref.triggerId), error: reason(error) })
    }
    if (sessionId) await finish(ref, 'finished', null, sessionId, now())
    else await finish(ref, 'failed', 'lost on restart', null, now())
  }

  /** One look at the one-shot. Returns true when the run is resolved (no more polling). */
  async function pollOnce(ref: Ref): Promise<boolean> {
    let reply: unknown
    try {
      reply = await rest.request('GET', jobPath(ref.jobId), query(ref.bot))
    } catch (error) {
      if (isStatus(error, 404)) {
        await recover(ref)
        return true
      }
      return expire(ref)
    }
    const job = jobSchema.safeParse(reply)
    const out = job.success ? outcomeOf(job.data) : null
    if (!out) return expire(ref)
    const run = await latestRun(ref)
    await finish(ref, out.outcome, out.detail, run.sessionId, run.endedAt ?? now())
    await deleteJob(ref)
    return true
  }

  /** Give up after 30 minutes; the job is left in place for inspection (R9). */
  async function expire(ref: Ref): Promise<boolean> {
    if (now() - ref.at <= maxPollMs) return false
    await finish(ref, 'failed', 'no result after 30 minutes', null, now())
    return true
  }

  function schedulePoll(ref: Ref): void {
    if (stopped) return
    const timer = setTimeout(() => {
      timers.delete(timer)
      void pollOnce(ref).then(done => { if (!done) schedulePoll(ref) }, error => {
        log.warn('trigger poll failed', { trigger: short(ref.triggerId), error: reason(error) })
        schedulePoll(ref)
      })
    }, pollMs)
    timers.add(timer)
  }

  async function fail(trigger: Trigger, event: TriggerEvent, handle: Held, status: 409 | 410 | 502 | 503, error: StartError, mayHaveRun = false): Promise<StartResult> {
    handle.release(mayHaveRun)
    await safe('logEvent', store.logEvent(trigger.id, event))
    return { ok: false, status, error, event }
  }

  async function start(trigger: Trigger, input: EventInput): Promise<StartResult> {
    const base = { id: input.eventId, at: input.at, deliveryId: input.deliveryId, eventType: input.eventType, action: input.action, jobId: null, runId: null, endedAt: null } as const
    const event = (outcome: TriggerOutcome, detail: string | null, jobId: string | null = null): TriggerEvent => ({ ...base, outcome, jobId, detail: detail === null ? null : cutDetail(detail) })
    const acquired = limiter.tryAcquire(trigger.id, now())
    if (!acquired.ok) {
      const e = event('too_many', acquired.detail)
      await safe('logEvent', store.logEvent(trigger.id, e))
      return { ok: false, status: 429, error: 'too_many_events', event: e }
    }
    let routine
    try {
      const parsed = jobSchema.safeParse(await rest.request('GET', jobPath(trigger.routineId), query(trigger.bot)))
      if (!parsed.success) return fail(trigger, event('failed', 'unexpected Hermes reply'), acquired, 502, 'hermes_refused')
      const owner = parsed.data.profile ?? parsed.data.profile_name
      if (owner && owner !== trigger.bot) return fail(trigger, event('failed', 'routine deleted'), acquired, 410, 'routine_deleted')
      routine = parsed.data
    } catch (error) {
      if (isStatus(error, 404)) return fail(trigger, event('failed', 'routine deleted'), acquired, 410, 'routine_deleted')
      return fail(trigger, event('failed', 'Hermes offline'), acquired, 503, 'hermes_offline')
    }
    if (isPausedJob(routine) && routine.paused_reason !== TRIGGER_ONLY_REASON) return fail(trigger, event('routine_paused', null), acquired, 409, 'routine_paused')
    const prompt = buildEventPrompt({ instruction: routine.prompt ?? '', source: trigger.source, eventType: input.eventType, action: input.action, payload: input.payload, ...(input.rawText === undefined ? {} : { rawText: input.rawText }) })
    let jobId: string | undefined
    try {
      const created = await rest.request<{ id?: unknown }>('POST', '/api/cron/jobs', { ...query(trigger.bot), body: oneShotBody(trigger, routine, input.eventType, prompt, now()) })
      jobId = typeof created?.id === 'string' && created.id ? created.id : undefined
    } catch (error) {
      if (isStatus(error, 400, 422)) return fail(trigger, event('failed', (error as HermesRestError).detail), acquired, 502, 'hermes_refused')
      // No HTTP answer (timeout, reset): the job may exist and fire anyway, so the hourly stamp stays.
      return fail(trigger, event('failed', 'Hermes offline'), acquired, 503, 'hermes_offline', !(error instanceof HermesRestError))
    }
    if (!jobId) return fail(trigger, event('failed', 'unexpected Hermes reply'), acquired, 502, 'hermes_refused')
    const started = event('started', null, jobId)
    held.set(input.eventId, acquired)
    await safe('logEvent', store.logEvent(trigger.id, started, input.deliveryId))
    rest.request('POST', `${jobPath(jobId)}/trigger`, { ...query(trigger.bot), timeoutMs: 0 }).catch((error: unknown) => {
      if (!isStatus(error, 409)) log.info('trigger fire request ended', { trigger: short(trigger.id), error: reason(error) })
    })
    schedulePoll({ triggerId: trigger.id, bot: trigger.bot, eventId: input.eventId, eventType: input.eventType, jobId, at: input.at })
    return { ok: true, event: started }
  }

  function resume(): void {
    const cutoff = now() - HOUR_MS
    for (const trigger of store.all()) {
      for (const e of store.events(trigger.id)) {
        if (!e.jobId || held.has(e.id)) continue
        const inFlight = e.outcome === 'started'
        if (!inFlight && e.at < cutoff) continue
        const handle = limiter.adopt(trigger.id, e.at)
        if (!inFlight) {
          handle.release(true)
          continue
        }
        held.set(e.id, handle)
        schedulePoll({ triggerId: trigger.id, bot: trigger.bot, eventId: e.id, eventType: e.eventType, jobId: e.jobId, at: e.at })
      }
    }
  }

  return {
    start,
    resume,
    stop() {
      stopped = true
      for (const timer of timers) clearTimeout(timer)
      timers.clear()
    }
  }
}
