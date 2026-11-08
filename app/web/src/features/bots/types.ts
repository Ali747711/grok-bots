// Copies of the server shapes (bots/create.ts, bots/edit.ts); the web never imports server code.

export interface BotLook {
  readonly shape: 'circle' | 'squircle'
  /** `#rrggbb` */
  readonly color: string
}

export interface ModelChoice {
  readonly provider: string
  readonly model: string
}

export interface BotDraft {
  readonly name: string
  readonly title: string
  readonly mission: string
  readonly look: BotLook
  readonly image?: string
  readonly model?: ModelChoice
}

export type StepOutcome = 'ok' | 'skipped' | 'failed'

export interface CreateResult {
  readonly name: string
  readonly complete: boolean
  readonly steps: { readonly profile: 'ok'; readonly look: StepOutcome; readonly avatar: StepOutcome; readonly chat: StepOutcome }
  readonly needsModel: boolean
  readonly error?: { readonly step: 'look' | 'avatar' | 'chat'; readonly message: string }
}

export interface FinishBody {
  readonly look?: BotLook
  readonly title?: string
  readonly image?: string
}

export interface BotDetail {
  readonly name: string
  readonly isPrimary: boolean
  readonly title: string
  readonly look: { readonly shape: string | null; readonly color: string | null; readonly imageKind: 'photo' | 'shape' | null }
  readonly hidden: boolean
  readonly description: string
  readonly soul: string
  readonly model: ModelChoice | null
  readonly metaRevision: number
}

export interface BotPatch {
  readonly title?: string
  readonly look?: BotLook
  readonly hidden?: boolean
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
