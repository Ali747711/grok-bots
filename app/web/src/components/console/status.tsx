import { cn } from '@/lib/utils'

export type StatusKind = 'idle' | 'working' | 'needs_you'

export const STATUS_LABEL: Record<StatusKind, string> = {
  idle: 'Idle',
  working: 'Working',
  needs_you: 'Needs you'
}

const DOT_COLOUR: Record<StatusKind, string> = {
  idle: 'bg-status-idle',
  working: 'bg-status-working',
  needs_you: 'bg-status-waiting'
}

interface StatusProps {
  status: StatusKind
  className?: string
}

function Dot({ status, className }: StatusProps) {
  return (
    <span aria-hidden="true" className={cn('relative inline-flex size-2 shrink-0', className)}>
      {status === 'working' && <span className="absolute inset-0 rounded-full bg-status-working motion-safe:animate-status-pulse" />}
      <span className={cn('relative size-full rounded-full', DOT_COLOUR[status])} />
    </span>
  )
}

/** 8px status dot. Only "working" moves, and only if motion is allowed. Screen readers get the status as text. */
export function StatusDot({ status, className }: StatusProps) {
  return (
    <>
      <Dot status={status} className={className} />
      <span className="sr-only">{STATUS_LABEL[status]}</span>
    </>
  )
}

/** Neutral status pill: a coloured dot and the label, so colour is never the only signal. */
export function StatusChip({ status, className }: StatusProps) {
  return (
    <span className={cn('inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full bg-raised px-2.5 text-xs font-medium text-muted-foreground', className)}>
      <Dot status={status} />
      {STATUS_LABEL[status]}
    </span>
  )
}
