/** Every `groups.*` call is made as the default profile: Hermes keys room ownership on it. */
export const GROUP_OWNER_PROFILE = 'default'

export type Routing = 'everyone' | 'auto' | 'lead'

// Wire types: only the fields Crew reads. Times are float seconds.
export interface HermesRoomMember {
  member_id: string
  profile: string
  handle: string
  display_name?: string
  target?: { kind: 'local'; profile: string }
}

export interface HermesRoom {
  room_id: string
  name: string
  members: HermesRoomMember[]
  authority_epoch: number
  revision: number
  created_at: number
  updated_at: number
  latest_seq?: number
}

export interface HermesRoomEvent {
  room_id: string
  seq: number
  event_id: string
  kind: string
  actor: { kind: string; id: string; profile?: string; display_name?: string }
  authority_epoch: number
  payload: Record<string, unknown>
  created_at: number
}

export interface HermesMemberActivity {
  member_id: string
  status: 'queued' | 'running' | 'stopping'
  started_at?: number
  tool?: string | null
  progress_at?: number | null
}

export type HermesPendingAction =
  | {
      kind: 'approval'
      member_id: string
      task_id: string
      execution_generation: number
      session_id: string
      request_id: string
      approval: { command?: string; description?: string; choices?: string[] }
    }
  | { kind: 'retry' | 'discard'; member_id: string; task_id: string; execution_generation: number }

export interface HermesDriverStatus {
  working: boolean
  blocked: boolean
  pending_actions: HermesPendingAction[]
  member_activity: HermesMemberActivity[]
  max_rounds: number
  max_continues: number
  last_error?: string | null
}

/** An unset lead is the empty string. */
export interface HermesRoomContext {
  purpose: string
  notes: string
  routing: Routing
  lead_member_id: string
}

export interface HermesRoomState {
  room: HermesRoom
  context?: HermesRoomContext
  driver_status?: HermesDriverStatus
}

export interface HermesRoomLog {
  events: HermesRoomEvent[]
  cursor: number
  latest_seq: number
  has_more: boolean
  authority: { epoch: number }
}

export interface HermesCapabilities {
  driver: boolean
  seatable_profiles: string[]
}

// Crew view types (mirrored in the web).
export interface GroupMemberView {
  memberId: string
  profile: string
  handle: string
  displayName: string | null
}

export interface GroupActivityView {
  memberId: string
  status: 'queued' | 'running' | 'stopping'
  tool: string | null
  stalled: boolean
}

export interface GroupTurnAction {
  memberId: string
  kind: 'retry' | 'discard'
  taskId: string
  executionGeneration: number
}

export interface GroupPreview {
  speaker: { kind: 'user' } | { kind: 'member'; memberId: string } | { kind: 'other'; label: string }
  text: string
}

export interface GroupView {
  id: string
  name: string
  members: GroupMemberView[]
  routing: Routing
  leadMemberId: string | null
  purpose: string
  notes: string
  latestSeq: number
  epoch: number
  /** Milliseconds. */
  updatedAt: number
  working: boolean
  /** Hermes cannot plan this room any more (a topic grew past its 24-message window). */
  stuck: boolean
  /** Why Hermes cannot start the room's next turn: a topic past its 24-message window, or another stalled prepare. */
  stuckReason: 'topic_limit' | 'prepare_failed' | null
  /** Coordinates of Hermes's room-wide `prepare:` retry action, when one is offered. */
  prepareRetry: { memberId: string; taskId: string; executionGeneration: number } | null
  lastError: string | null
  activity: GroupActivityView[]
  turnActions: GroupTurnAction[]
  maxContinues: number
  maxRounds: number
  preview: GroupPreview | null
}

export interface GroupsState {
  available: boolean
  seatable: string[]
  rooms: GroupView[]
}

/** One room event as the browser sees it: only these payload keys are copied. */
export interface GroupEvent {
  seq: number
  eventId: string
  kind: string
  /** Milliseconds. */
  createdAt: number
  actor: { kind: string; id: string; profile: string | null; displayName: string | null }
  text?: string
  threadId?: string
  memberId?: string
  discussionEventId?: string
  roundIndex?: number
  status?: string
  reasonCode?: string
  error?: string
  reason?: string
  memberIds?: string[]
  everyone?: boolean
  fallback?: boolean
  name?: string
  routing?: string
  leadMemberId?: string
}
