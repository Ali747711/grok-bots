import { type PillTone, StatusPill } from '@/components/console/status-pill'

import type { TriggerOutcome } from './types'

export const OUTCOME: Record<TriggerOutcome, { text: string; tone: PillTone }> = {
  started: { text: 'Started', tone: 'ok' },
  finished: { text: 'Finished', tone: 'ok' },
  failed: { text: 'Failed', tone: 'error' },
  blocked: { text: "Blocked by Hermes's safety check", tone: 'warn' },
  ignored: { text: 'Ignored by the filter', tone: 'quiet' },
  duplicate: { text: 'Duplicate', tone: 'quiet' },
  bad_signature: { text: 'Bad signature', tone: 'error' },
  too_many: { text: 'Too many events', tone: 'warn' },
  trigger_off: { text: 'Trigger off', tone: 'quiet' },
  routine_paused: { text: 'Routine paused', tone: 'warn' },
  too_large: { text: 'Too big', tone: 'error' }
}

export function OutcomeBadge({ outcome }: { outcome: TriggerOutcome }) {
  const { text, tone } = OUTCOME[outcome]
  return <StatusPill tone={tone}>{text}</StatusPill>
}
