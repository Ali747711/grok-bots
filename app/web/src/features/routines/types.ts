// Copies of the server shapes (routines/schedule.ts, routines/mapping.ts); the web never imports server code.

export type Unit = 'm' | 'h' | 'd'

export type ScheduleSpec =
  | { kind: 'once_in'; amount: number; unit: Unit }
  | { kind: 'once_at'; at: string }
  | { kind: 'every'; amount: number; unit: Unit }
  | { kind: 'daily'; time: string }
  | { kind: 'weekdays'; time: string }
  | { kind: 'weekly'; day: number; time: string }
  | { kind: 'monthly'; day: number; time: string }
  | { kind: 'cron'; expr: string }

export type ScheduleKind = ScheduleSpec['kind']

export interface RoutineInput {
  readonly title: string
  readonly instruction: string
  readonly schedule: ScheduleSpec
  readonly timezone: string
  readonly deliverToChat: boolean
  /** Edit only: true when the user changed the zone or the schedule (the server keeps a stored zone otherwise). */
  readonly timezoneChanged?: boolean
  /** Always sent on save: the server keeps the current mode when it is absent. */
  readonly runs?: 'schedule' | 'triggered'
}

export type LastStatus = 'ok' | 'error' | 'delivery_failed' | 'blocked_config'

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
  readonly lastStatus: LastStatus | null
  readonly lastError: string | null
  readonly running: boolean
  /** Hermes job state: scheduled, paused, completed, error ... */
  readonly state: string | null
  /** A one-time routine that ran (or a job Hermes retired): it can no longer be paused, resumed or run. */
  readonly finished: boolean
  /** Runs only when a trigger fires it; it has no schedule and no pause switch. */
  readonly triggerOnly: boolean
}

export interface RunView {
  readonly id: string
  readonly status: 'running' | 'completed' | 'failed' | 'cancelled' | 'missed'
  readonly startedAt: number
  readonly endedAt: number | null
  readonly title: string
  readonly sessionId: string | null
  readonly error: string | null
  /** Set on rows that Crew built from a trigger event. */
  readonly trigger?: { readonly id: string; readonly name: string; readonly eventType: string }
}
