import { type Job, isFinished } from '../routines/mapping.js'
import { titleOf } from '../routines/mapping.js'
import { cutDetail, jobNameFor, type Trigger } from './types.js'

export const COPY_FIELDS = ['deliver', 'model', 'provider', 'base_url', 'skills', 'enabled_toolsets', 'workdir', 'script', 'context_from', 'timezone'] as const

/** `YYYY-MM-DDTHH:MM:SS+00:00`: an instant already due, so triggering it fires it exactly once. */
export const isoSeconds = (ms: number): string => `${new Date(ms).toISOString().slice(0, 19)}+00:00`

/** The one-shot copy of a routine: its settings, the event prompt, and a name Crew can find again. */
export function oneShotBody(trigger: Trigger, routine: Job, eventType: string, prompt: string, nowMs: number): Record<string, unknown> {
  const source = routine as Record<string, unknown>
  const body: Record<string, unknown> = {
    name: jobNameFor(trigger.id, titleOf(routine), eventType),
    prompt,
    schedule: isoSeconds(nowMs),
    deliver: routine.deliver ?? 'local'
  }
  for (const field of COPY_FIELDS) {
    if (field !== 'deliver' && source[field] !== null && source[field] !== undefined) body[field] = source[field]
  }
  return body
}

export interface JobOutcome {
  readonly outcome: 'finished' | 'failed' | 'blocked'
  readonly detail: string | null
}

/** Null until the one-shot has run; then how it ended, from Hermes's own status fields. */
export function outcomeOf(job: Job): JobOutcome | null {
  const terminal = isFinished(job.state) || (Boolean(job.last_run_at) && !job.live_execution)
  if (!terminal) return null
  const status = job.last_status
  if (status === 'delivery_failed') return { outcome: 'finished', detail: cutDetail(`Delivery failed: ${job.last_delivery_error ?? ''}`) }
  if (status === 'error' && job.last_error?.startsWith('Blocked:')) return { outcome: 'blocked', detail: cutDetail(job.last_error) }
  if (status === 'error' || status === 'blocked_config' || status === 'cancelled') return { outcome: 'failed', detail: cutDetail(job.last_error ?? status) }
  return { outcome: 'finished', detail: null }
}
