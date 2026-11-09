// Hand copies of the server shapes (triggers/types.ts, http/trigger-routes.ts); the web never imports server code.

export type TriggerSource = 'github' | 'generic'

export type TriggerOutcome =
  | 'started' | 'finished' | 'failed' | 'blocked' | 'ignored' | 'duplicate'
  | 'bad_signature' | 'too_many' | 'trigger_off' | 'routine_paused' | 'too_large'

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

/** A trigger as the list shows it: never the secret. */
export interface TriggerView {
  readonly id: string
  readonly bot: string
  readonly routineId: string
  readonly name: string
  readonly source: TriggerSource
  readonly events: readonly string[]
  readonly actions: readonly string[]
  readonly enabled: boolean
  readonly createdAt: number
  readonly url: string
  readonly lastEvent: TriggerEvent | null
}

export interface NewTrigger {
  readonly routineId: string
  readonly name: string
  readonly source: TriggerSource
  readonly events: string[]
  readonly actions: string[]
}

/** `saved: false` means the change is live but not on disk yet. */
export interface Unsaved {
  readonly saved?: false
}

export type CreatedTrigger = Unsaved & { readonly trigger: TriggerView; readonly secret: string; readonly url: string }

export interface TriggerPatch {
  readonly name?: string
  readonly enabled?: boolean
  readonly events?: string[]
  readonly actions?: string[]
}

export interface TestEventResult {
  readonly httpStatus: number
  readonly event: TriggerEvent | null
}
