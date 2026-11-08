export interface WorkStep {
  id: string
  name: string
  summary: string
  detail?: string
  isError?: boolean
  running: boolean
}

export type ChatItem =
  | { kind: 'assistant'; id: string; text: string }
  /** `delivery`: 'checking' while a lost receipt is being reconciled, 'not_sent' once Hermes shows no sign of it (Retry resubmits `submissionId`). */
  | { kind: 'user'; id: string; text: string; submissionId?: string; delivery?: 'checking' | 'not_sent' }
  | { kind: 'work'; id: string; steps: WorkStep[]; durationS?: number }
  | { kind: 'notice'; id: string; text: string }
