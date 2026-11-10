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
  /**
   * `delivery`: 'checking' while a lost receipt is being re-submitted, 'not_sent' (with `reason`) when it could not be confirmed;
   * Retry resubmits the same `submissionId`. `queued`: Hermes took the message behind a running turn; cleared when the next turn starts.
   */
  | { kind: 'user'; id: string; text: string; submissionId?: string; delivery?: 'checking' | 'not_sent'; reason?: string; queued?: true }
  /** `interrupted`: the turn was stopped before it finished. */
  | { kind: 'work'; id: string; steps: WorkStep[]; durationS?: number; interrupted?: true }
  | { kind: 'notice'; id: string; text: string }
