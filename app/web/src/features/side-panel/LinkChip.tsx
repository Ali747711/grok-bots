import type { LinkState } from '@/features/computer/live-session'
import type { ScreenControl, ScreenKind } from '@/features/computer/screen-state'
import { cn } from '@/lib/utils'

import { linkChip } from './link-chip'

interface LinkChipProps {
  readonly kind: ScreenKind
  readonly link: LinkState
  readonly control: ScreenControl
}

/**
 * The screen's connection and who holds control, as one polite status. The watermelon dot is the only
 * accent; the text never takes it. Adapted from crew-bots' computer panel.
 */
export function LinkChip({ kind, link, control }: LinkChipProps) {
  const { text, accent } = linkChip(kind, link, control)
  return (
    <span role="status" aria-live="polite" className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-background px-2.5 text-xs font-medium text-muted-foreground">
      <span aria-hidden="true" data-accent={accent ? 'true' : undefined} className={cn('size-1.5 shrink-0 rounded-full', accent ? 'bg-watermelon' : 'border border-status-idle')} />
      <span className="truncate">{text}</span>
    </span>
  )
}
