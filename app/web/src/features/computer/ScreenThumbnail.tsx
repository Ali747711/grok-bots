import { cn } from '@/lib/utils'
import type { BotView } from '@/state/types'

import { useScreen } from './use-screen'
import { useThumbnail } from './use-thumbnail'

interface ScreenThumbnailProps {
  readonly bot: BotView
  /** True while the Computer tab is open: it shows the live view, so the preview steps aside. */
  readonly hidden: boolean
  readonly onOpen: () => void
}

/**
 * A small live preview of the bot's screen in the chat header. It only reads status and thumbnails,
 * never dials a viewer. The header has no viewer, so a withheld frame (a human holds control) reads
 * "Someone is in control" unless the lease happens to be ours.
 */
export function ScreenThumbnail({ bot, hidden, onOpen }: ScreenThumbnailProps) {
  const { view } = useScreen(bot.name)
  const thumb = useThumbnail(bot.name, view.kind === 'live' && !hidden)
  if (hidden || view.kind !== 'live') return null
  if (thumb.suppressed) {
    return <span role="status" className="shrink-0 whitespace-nowrap rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground">{view.control === 'you' ? "You're in control" : 'Someone is in control'}</span>
  }
  if (!thumb.src) return null
  return (
    <button
      type="button"
      onClick={onOpen}
      data-stale={thumb.stale ? 'true' : undefined}
      title={thumb.stale ? 'This preview may be out of date' : undefined}
      className={cn('h-8 w-[3.2rem] shrink-0 overflow-hidden rounded border border-border bg-muted outline-none focus-visible:ring-3 focus-visible:ring-ring/50', thumb.stale && 'opacity-50')}
    >
      <img src={thumb.src} alt={`${bot.title}'s screen`} className="size-full object-cover" />
    </button>
  )
}
