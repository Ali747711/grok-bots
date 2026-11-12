import type { AvatarFace, AvatarGlasses, AvatarHat, AvatarType } from '@/features/avatars/avatar-model'

import type { BotRole } from './roles'

// Copies of the server shapes (bots/create.ts, bots/edit.ts); the web never imports server code.

export interface ModelChoice {
  readonly provider: string
  readonly model: string
}

/** The avatar as the create and finish routes take it; no colour means the type's own. */
export interface AvatarChoice {
  readonly type: AvatarType
  readonly color?: string
  readonly face?: AvatarFace
  readonly hat?: AvatarHat
  readonly glasses?: AvatarGlasses
  readonly headphones?: boolean
  readonly bowTie?: boolean
}

export interface BotDraft {
  readonly name: string
  readonly title: string
  readonly mission: string
  readonly avatar: AvatarChoice
  readonly image?: string
  readonly role?: BotRole | null
  readonly model?: ModelChoice
  readonly sandbox: boolean
}

export type StepOutcome = 'ok' | 'skipped' | 'failed'

export interface CreateResult {
  readonly name: string
  readonly complete: boolean
  readonly steps: { readonly profile: 'ok'; readonly apps: StepOutcome; readonly look: StepOutcome; readonly avatar: StepOutcome; readonly chat: StepOutcome; readonly sandbox: StepOutcome; readonly voice?: StepOutcome }
  readonly needsModel: boolean
  readonly error?: { readonly step: 'apps' | 'look' | 'avatar' | 'chat' | 'sandbox' | 'voice'; readonly message: string }
}

export interface FinishBody {
  readonly avatar?: AvatarChoice
  readonly title?: string
  readonly image?: string
}

export interface BotDetail {
  readonly name: string
  readonly isPrimary: boolean
  readonly title: string
  readonly look: { readonly shape: string | null; readonly color: string | null; readonly imageKind: 'photo' | 'shape' | null }
  /** The chosen avatar; null when never set. */
  readonly avatar: AvatarChoice | null
  readonly hidden: boolean
  readonly pinned: boolean
  readonly role: BotRole | null
  readonly description: string
  readonly soul: string
  readonly model: ModelChoice | null
  readonly metaRevision: number
}

export interface BotPatch {
  readonly title?: string
  /** Saved at once when the user picks one; not a guarded field. */
  readonly avatar?: AvatarChoice
  readonly hidden?: boolean
  readonly pinned?: boolean
  readonly role?: BotRole | null
  readonly description?: string
  readonly soul?: string
  readonly model?: ModelChoice
  readonly confirmExpensiveModel?: boolean
  /** Required for each of soul / description / model the patch contains. */
  readonly baseline?: { readonly description?: string; readonly soul?: string; readonly model?: ModelChoice | null }
}

export type UpdateOutcome =
  | { status: 'saved'; detail: BotDetail }
  | { status: 'conflict'; fields: ('description' | 'soul' | 'model')[]; current: BotDetail }
  | { status: 'confirm_required'; message: string }
