import { log } from '../log.js'
import { parsePayload, payloadAction } from './payload.js'
import type { EventInput, StartError, TriggerRunner } from './runner.js'
import type { TriggerStore } from './store.js'
import type { Trigger, TriggerEvent, TriggerOutcome } from './types.js'
import { eventNameOf, type HeaderGetter, verifyGeneric, verifyGithub } from './verify.js'

export const MAX_HOOK_BYTES = 1_048_576

export type HookError = 'not_found' | 'too_large' | 'trigger_off' | 'bad_signature' | StartError
export type HookBody = { status: 'accepted'; event: string; eventId: string } | { status: 'ignored' | 'duplicate' | 'pong' } | { error: HookError }

export interface HookResult {
  readonly status: 200 | 202 | 401 | 403 | 404 | 409 | 410 | 413 | 429 | 502 | 503
  readonly body: HookBody
  readonly event: TriggerEvent | null
}

export interface HookDeps {
  readonly store: TriggerStore
  readonly runner: Pick<TriggerRunner, 'start'>
  readonly now: () => number
  readonly newId: () => string
}

export interface HookHandler {
  /** `raw` is null when the body was over 1 MiB (the route stopped reading). */
  handle(triggerId: string, raw: Buffer | null, headers: HeaderGetter): Promise<HookResult>
}

type Filter = { ok: true } | { ok: false; detail: 'not in the event filter' | 'action not in the filter' }

/** Empty lists mean "everything"; names match exactly (R5). The action filter applies only to events that carry an action. */
export function passesFilter(trigger: Trigger, eventType: string, action: string | null): Filter {
  if (trigger.events.length > 0 && !trigger.events.includes(eventType)) return { ok: false, detail: 'not in the event filter' }
  if (trigger.actions.length > 0 && action !== null && !trigger.actions.includes(action)) return { ok: false, detail: 'action not in the filter' }
  return { ok: true }
}

const short = (id: string): string => id.slice(0, 8)
const THROTTLE_MS = 60_000
const UNKNOWN = ''

/**
 * Outcomes of unauthenticated requests (bad signature, trigger off, too large, unknown id) are written
 * and logged at most once a minute per key; the rest are counted and the next written one reports them.
 */
function createThrottle(now: () => number): (key: string) => { pass: false } | { pass: true; more: number } {
  const state = new Map<string, { at: number; more: number }>()
  return key => {
    const s = state.get(key)
    if (s && now() - s.at < THROTTLE_MS) {
      s.more++
      return { pass: false }
    }
    state.set(key, { at: now(), more: 0 })
    return { pass: true, more: s?.more ?? 0 }
  }
}

export function createHookHandler(deps: HookDeps): HookHandler {
  const { store, runner, now, newId } = deps
  /** Deliveries being handled right now: a second request with the same id must not start a second run. */
  const reserved = new Set<string>()
  const gate = createThrottle(now)

  const record = async (trigger: Trigger, event: TriggerEvent, deliveryId: string | null = null): Promise<void> => {
    try {
      await store.logEvent(trigger.id, event, deliveryId)
    } catch (error) {
      log.warn('trigger store write failed', { what: 'logEvent', error: error instanceof Error ? error.message.slice(0, 200) : 'unknown' })
    }
  }

  const done = (trigger: Trigger, status: HookResult['status'], body: HookBody, outcome: string, event: TriggerEvent | null): HookResult => {
    log.info('hook event', { trigger: short(trigger.id), status, outcome })
    return { status, body, event }
  }

  /** An unauthenticated outcome: written and logged once a minute per trigger; the answer never changes. */
  const unverified = async (trigger: Trigger, status: 401 | 403 | 413, error: 'bad_signature' | 'trigger_off' | 'too_large', event: TriggerEvent): Promise<HookResult> => {
    const g = gate(trigger.id)
    if (g.pass) {
      const more = g.more > 0 ? `+${g.more} more in the last minute` : null
      const detail = [event.detail, more].filter(Boolean).join(' ') || null
      await record(trigger, { ...event, detail })
      log.info('hook event', { trigger: short(trigger.id), status, outcome: error, ...(g.more > 0 ? { more: g.more } : {}) })
    }
    return { status, body: { error }, event }
  }

  const unknownTrigger = (status: 404 | 413, body: HookBody): HookResult => {
    const g = gate(UNKNOWN)
    if (g.pass) log.info('hook for unknown trigger', g.more > 0 ? { more: g.more } : {})
    return { status, body, event: null }
  }

  async function handle(triggerId: string, raw: Buffer | null, headers: HeaderGetter): Promise<HookResult> {
    const trigger = store.get(triggerId)
    const github = trigger?.source === 'github'
    // Before the signature check the event type is only what the sender claims; it is never trusted.
    const claimed = trigger ? (eventNameOf(headers.get(github ? 'x-github-event' : 'x-crew-event')) ?? (github ? 'unknown' : 'event')) : 'unknown'
    const make = (outcome: TriggerOutcome, detail: string | null, extra: { eventType?: string; action?: string | null; deliveryId?: string | null } = {}): TriggerEvent => ({
      id: newId(), at: now(), deliveryId: extra.deliveryId ?? null, eventType: extra.eventType ?? claimed, action: extra.action ?? null,
      outcome, jobId: null, runId: null, endedAt: null, detail
    })

    if (raw === null) {
      if (!trigger) return unknownTrigger(413, { error: 'too_large' })
      return unverified(trigger, 413, 'too_large', make('too_large', null))
    }
    if (!trigger) return unknownTrigger(404, { error: 'not_found' })
    if (!trigger.enabled) return unverified(trigger, 403, 'trigger_off', make('trigger_off', null))
    const verified = trigger.source === 'github' ? verifyGithub(raw, headers, trigger.secret) : verifyGeneric(raw, headers, trigger.secret, now())
    if (!verified.ok) {
      return unverified(trigger, 401, 'bad_signature', make('bad_signature', verified.reason))
    }
    const { eventType, deliveryId } = verified
    const known = { eventType, deliveryId }
    if (github && eventType === 'ping') {
      const event = make('ignored', 'GitHub ping', known)
      await record(trigger, event, deliveryId)
      return done(trigger, 200, { status: 'pong' }, 'ping', event)
    }
    const key = deliveryId === null ? null : `${trigger.id}:${deliveryId}`
    if (deliveryId !== null && (store.seenDelivery(trigger.id, deliveryId) || reserved.has(key!))) {
      const event = make('duplicate', null, known)
      await record(trigger, event)
      return done(trigger, 200, { status: 'duplicate' }, 'duplicate', event)
    }
    if (key) reserved.add(key)
    try {
      return await accept(trigger, raw, headers, known, make)
    } finally {
      if (key) reserved.delete(key)
    }
  }

  async function accept(
    trigger: Trigger, raw: Buffer, headers: HeaderGetter, known: { eventType: string; deliveryId: string | null },
    make: (outcome: TriggerOutcome, detail: string | null, extra?: { eventType?: string; action?: string | null; deliveryId?: string | null }) => TriggerEvent
  ): Promise<HookResult> {
    const payload = parsePayload(raw, headers.get('content-type'))
    const action = trigger.source === 'github' ? payloadAction(payload) : null
    const filter = passesFilter(trigger, known.eventType, action)
    if (!filter.ok) {
      const event = make('ignored', filter.detail, { ...known, action })
      await record(trigger, event, known.deliveryId)
      return done(trigger, 200, { status: 'ignored' }, 'ignored', event)
    }
    const eventId = newId()
    const input: EventInput = { eventId, at: now(), deliveryId: known.deliveryId, eventType: known.eventType, action, payload, rawText: raw.toString('utf8') }
    const result = await runner.start(trigger, input)
    if (result.ok) return done(trigger, 202, { status: 'accepted', event: known.eventType, eventId }, 'started', result.event)
    return done(trigger, result.status, { error: result.error }, result.event.outcome, result.event)
  }

  return { handle }
}
