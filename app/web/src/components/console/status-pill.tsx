import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

/** What a pill's dot says: went well, went wrong, needs a look, or nothing to act on. */
export type PillTone = 'ok' | 'error' | 'warn' | 'quiet'

const DOT: Record<PillTone, string> = {
  ok: 'bg-status-working',
  error: 'bg-status-error',
  warn: 'bg-status-waiting',
  quiet: 'bg-status-idle'
}

interface StatusPillProps {
  tone: PillTone
  /** Shown on hover, e.g. the error behind a failed result. */
  title?: string
  children: ReactNode
}

/**
 * A result or outcome: a neutral pill with a coloured dot and the word. The colour is only ever the dot,
 * so the text stays readable in both themes (no red text on a red tint) and is never the only signal.
 */
export function StatusPill({ tone, title, children }: StatusPillProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 w-fit shrink-0 items-center gap-1.5 rounded-full bg-raised px-2 text-xs font-medium whitespace-nowrap ring-1 ring-border',
        tone === 'quiet' ? 'text-muted-foreground' : 'text-foreground'
      )}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', DOT[tone])} />
      {children}
    </span>
  )
}
