// Mirrors the shapes served by GET /crew/state and /crew/events (server: watcher/bot-state.ts).
// Kept as a copy on purpose: the web app never imports server code.

import type { AvatarType } from '@/features/avatars/avatar-model'

export type BotStatus = 'idle' | 'working' | 'needs_you'
export type HermesConnection = 'connected' | 'connecting' | 'signed_out' | 'offline'

export interface BotView {
  readonly name: string
  readonly title: string
  /** The Hermes display name, when one is set. Missing on older servers. */
  readonly displayName?: string | null
  readonly color: string | null
  readonly shape: string | null
  readonly isPrimary: boolean
  readonly hasAvatar: boolean
  /** The bot's chosen avatar type and colour; null when never set. */
  readonly avatar: { readonly type: AvatarType; readonly color?: string } | null
  readonly imageKind: 'photo' | 'shape' | null
  readonly model: string | null
  readonly sessionId: string | null
  readonly preview: string | null
  readonly lastActive: number | null
  readonly status: BotStatus
  readonly hidden: boolean
  /** Created but its look was never written; the Profile panel finishes it. */
  readonly setupIncomplete: boolean
  readonly created: number | null
}

export type PendingKind = 'approval' | 'clarify' | 'secret' | 'sudo'

export interface PendingView {
  readonly id: string
  readonly kind: PendingKind
  readonly profile: string
  readonly sessionId: string
  readonly summary: string
  /** Approvals only: the full text (each up to 16,384 chars). */
  readonly command?: string
  readonly description?: string
  /** True when command/description were cut by the server; never offer an allow choice then. */
  readonly detailTruncated?: true
  readonly choices?: readonly string[]
  readonly receivedAt: number
  readonly source: 'server_request' | 'open_request' | 'snapshot_prompt' | 'event' | 'group'
  readonly promptId?: string
  readonly executionGeneration?: number
  /** Group approvals only: where the answer goes. */
  readonly group?: { readonly roomId: string; readonly memberId: string; readonly taskId: string; readonly requestId: string }
  readonly state: 'open' | 'answering' | 'failed'
  readonly answerable: boolean
  readonly error?: string
}

export interface CrewSettings {
  /** Integer 1-20, or null for no limit. */
  readonly maxWorkingBots: number | null
}

export interface CrewState {
  readonly hermes: HermesConnection
  readonly bots: readonly BotView[]
  readonly pending: readonly PendingView[]
  /** Missing when talking to an older server. */
  readonly settings?: CrewSettings
  /** Missing when talking to an older server. */
  readonly groups?: GroupsState
}

export type Routing = 'everyone' | 'auto' | 'lead'

export interface GroupMemberView {
  readonly memberId: string
  readonly profile: string
  readonly handle: string
  readonly displayName: string | null
}

export interface GroupActivityView {
  readonly memberId: string
  readonly status: 'queued' | 'running' | 'stopping'
  readonly tool: string | null
  readonly stalled: boolean
}

export interface GroupTurnAction {
  readonly memberId: string
  readonly kind: 'retry' | 'discard'
  readonly taskId: string
  readonly executionGeneration: number
}

export interface GroupPreview {
  readonly speaker: { readonly kind: 'user' } | { readonly kind: 'member'; readonly memberId: string } | { readonly kind: 'other'; readonly label: string }
  readonly text: string
}

export interface GroupView {
  readonly id: string
  readonly name: string
  readonly members: readonly GroupMemberView[]
  readonly routing: Routing
  readonly leadMemberId: string | null
  readonly purpose: string
  readonly notes: string
  readonly latestSeq: number
  readonly epoch: number
  /** Milliseconds. */
  readonly updatedAt: number
  readonly working: boolean
  /** Hermes cannot plan this room any more (a topic grew past its 24-message window). */
  readonly stuck: boolean
  readonly activity: readonly GroupActivityView[]
  readonly turnActions: readonly GroupTurnAction[]
  readonly maxContinues: number
  readonly maxRounds: number
  readonly preview: GroupPreview | null
}

export interface GroupsState {
  readonly available: boolean
  readonly seatable: readonly string[]
  readonly rooms: readonly GroupView[]
}

/** One room event as the browser sees it. */
export interface GroupEvent {
  readonly seq: number
  readonly eventId: string
  readonly kind: string
  /** Milliseconds. */
  readonly createdAt: number
  readonly actor: { readonly kind: string; readonly id: string; readonly profile: string | null; readonly displayName: string | null }
  readonly text?: string
  readonly threadId?: string
  readonly memberId?: string
  readonly discussionEventId?: string
  readonly roundIndex?: number
  readonly status?: string
  readonly reasonCode?: string
  readonly error?: string
  readonly reason?: string
  readonly memberIds?: readonly string[]
  readonly everyone?: boolean
  readonly fallback?: boolean
  readonly name?: string
  readonly routing?: string
  readonly leadMemberId?: string
}
