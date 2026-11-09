// Mirrors the shapes served by GET /crew/state and /crew/events (server: watcher/bot-state.ts).
// Kept as a copy on purpose: the web app never imports server code.

import type { AvatarType } from '@/features/avatars/avatar-model'

export type BotStatus = 'idle' | 'working' | 'needs_you'
export type HermesConnection = 'connected' | 'connecting' | 'signed_out' | 'offline'

export interface BotView {
  readonly name: string
  readonly title: string
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
  readonly source: 'server_request' | 'open_request' | 'snapshot_prompt' | 'event'
  readonly promptId?: string
  readonly executionGeneration?: number
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
}
