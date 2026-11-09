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

/** Empty lists mean "everything"; the action filter applies only to events that carry an action. */
export function passesFilter(trigger: Trigger, eventType: string, action: string | null): Filter {
  const has = (list: readonly string[], value: string) => list.some(v => v.toLowerCase() === value.toLowerCase())
  if (trigger.events.length > 0 && !has(trigger.events, eventType)) return { ok: false, detail: 'not in the event filter' }
  if (trigger.actions.length > 0 && action !== null && !has(trigger.actions, action)) return { ok: false, detail: 'action not in the filter' }
  return { ok: true }
}

const short = (id: string): string => id.slice(0, 8)

export function createHookHandler(deps: HookDeps): HookHandler {
  const { store, runner, now, newId } = deps
  /** Deliveries being handled right now: a second request with the same id must not start a second run. */
  const reserved = new Set<string>()

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
      if (!trigger) return { status: 413, body: { error: 'too_large' }, event: null }
      const event = make('too_large', null)
      await record(trigger, event)
      return done(trigger, 413, { error: 'too_large' }, 'too_large', event)
    }
    if (!trigger) {
      log.info('hook for unknown trigger')
      return { status: 404, body: { error: 'not_found' }, event: null }
    }
    if (!trigger.enabled) {
      const event = make('trigger_off', null)
      await record(trigger, event)
      return done(trigger, 403, { error: 'trigger_off' }, 'trigger_off', event)
    }
    const verified = trigger.source === 'github' ? verifyGithub(raw, headers, trigger.secret) : verifyGeneric(raw, headers, trigger.secret, now())
    if (!verified.ok) {
      const event = make('bad_signature', verified.reason)
      await record(trigger, event)
      return done(trigger, 401, { error: 'bad_signature' }, 'bad_signature', event)
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
