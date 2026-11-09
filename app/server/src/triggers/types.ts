export type TriggerSource = 'github' | 'generic'

export type TriggerOutcome =
  | 'started'
  | 'finished'
  | 'failed'
  | 'blocked'
  | 'ignored'
  | 'duplicate'
  | 'bad_signature'
  | 'too_many'
  | 'trigger_off'
  | 'routine_paused'
  | 'too_large'

export interface Trigger {
  readonly id: string
  readonly bot: string
  readonly routineId: string
  readonly name: string
  readonly source: TriggerSource
  readonly events: readonly string[]
  readonly actions: readonly string[]
  readonly enabled: boolean
  readonly secret: string
  readonly createdAt: number
}

export interface TriggerEvent {
  readonly id: string
  readonly at: number
  readonly deliveryId: string | null
  readonly eventType: string
  readonly action: string | null
  readonly outcome: TriggerOutcome
  readonly jobId: string | null
  readonly runId: string | null
  readonly endedAt: number | null
  readonly detail: string | null
}

export type TriggerView = Omit<Trigger, 'secret'> & { readonly url: string; readonly lastEvent: TriggerEvent | null }

export type TriggerPatch = Partial<Pick<Trigger, 'name' | 'enabled' | 'events' | 'actions' | 'secret'>>
export type EventPatch = Partial<Pick<TriggerEvent, 'outcome' | 'runId' | 'endedAt' | 'detail'>>

export interface TriggerRun {
  readonly triggerId: string
  readonly triggerName: string
  readonly event: TriggerEvent
}

export const EVENT_LOG_MAX = 50
export const DELIVERY_IDS_MAX = 500
export const DETAIL_MAX = 200
export const TRIGGER_ID_RE = /^[0-9a-f]{32}$/
export const ROUTINE_ID_RE = /^[A-Za-z0-9_-]{1,64}$/
export const EVENT_NAME_RE = /^[A-Za-z0-9._:/-]{1,64}$/
export const TRIGGER_JOB_RE = /^\[trigger:[0-9a-f]{32}\]/

/** The one-shot job name; the `[trigger:<id>]` prefix lets Crew find its own jobs again. */
export function jobNameFor(triggerId: string, routineTitle: string, eventType: string): string {
  return `[trigger:${triggerId}] ${routineTitle} · ${eventType}`
}

/** The secret never leaves the server except in the create and rotate replies. */
export function toView(trigger: Trigger, url: string, lastEvent: TriggerEvent | null): TriggerView {
  const { secret: _secret, ...rest } = trigger
  return { ...rest, url, lastEvent }
}

export const cutDetail = (text: string): string => text.slice(0, DETAIL_MAX)
