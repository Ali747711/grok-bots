export interface WorkStep {
  id: string
  name: string
  summary: string
  detail?: string
  isError?: boolean
  running: boolean
}

export type ChatItem =
  | { kind: 'user' | 'assistant'; id: string; text: string }
  | { kind: 'work'; id: string; steps: WorkStep[]; durationS?: number }
  | { kind: 'notice'; id: string; text: string }
