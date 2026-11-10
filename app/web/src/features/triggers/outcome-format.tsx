import { CircleCheck, CircleDot, CircleX, Copy, FileWarning, Funnel, Gauge, KeyRound, Pause, PowerOff, ShieldAlert, type LucideIcon } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { TriggerOutcome } from './types'

const MUTED = 'bg-muted text-muted-foreground'
const DANGER = 'bg-destructive/10 text-destructive'
const WARN = 'bg-status-waiting/15 text-foreground'

export const OUTCOME: Record<TriggerOutcome, { text: string; tone: string; Icon: LucideIcon }> = {
  started: { text: 'Started', tone: 'bg-raised text-foreground', Icon: CircleDot },
  finished: { text: 'Finished', tone: 'bg-status-working/15 text-foreground', Icon: CircleCheck },
  failed: { text: 'Failed', tone: DANGER, Icon: CircleX },
  blocked: { text: "Blocked by Hermes's safety check", tone: WARN, Icon: ShieldAlert },
  ignored: { text: 'Ignored by the filter', tone: MUTED, Icon: Funnel },
  duplicate: { text: 'Duplicate', tone: MUTED, Icon: Copy },
  bad_signature: { text: 'Bad signature', tone: DANGER, Icon: KeyRound },
  too_many: { text: 'Too many events', tone: WARN, Icon: Gauge },
  trigger_off: { text: 'Trigger off', tone: MUTED, Icon: PowerOff },
  routine_paused: { text: 'Routine paused', tone: WARN, Icon: Pause },
  too_large: { text: 'Too big', tone: DANGER, Icon: FileWarning }
}

export function OutcomeBadge({ outcome }: { outcome: TriggerOutcome }) {
  const { text, tone, Icon } = OUTCOME[outcome]
  return (
    <Badge className={cn('h-5 gap-1 px-2 text-xs', tone)}>
      <Icon aria-hidden className="size-3" />
      {text}
    </Badge>
  )
}
