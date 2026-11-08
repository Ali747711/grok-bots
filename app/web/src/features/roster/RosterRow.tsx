import { Badge } from '@/components/ui/badge'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { cn } from '@/lib/utils'
import type { BotView } from '@/state/types'

interface RosterRowProps {
  bot: BotView
  active: boolean
  showStatus: boolean
  onSelect: (name: string) => void
}

/** One bot in the roster: avatar, name, one-line preview. The selected row gets the sky fill and a left bar. */
export function RosterRow({ bot, active, showStatus, onSelect }: RosterRowProps) {
  return (
    <button
      type="button"
      data-bot={bot.name}
      data-selected={active ? 'true' : undefined}
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(bot.name)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-2xl p-2 text-left transition-colors hover:bg-muted',
        active && 'bg-sky-soft shadow-[inset_3px_0_0_var(--sky)] hover:bg-sky-soft'
      )}
    >
      <CrewAvatar bot={bot} size={36} decorative />
      {showStatus && <span data-testid={`status-${bot.name}`} data-status={bot.status} aria-hidden="true" className="sr-only" />}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-sm font-semibold', active && 'text-sky')}>{bot.title}</span>
          {bot.setupIncomplete && (
            <Badge variant="secondary" className="h-4 px-1.5 text-[10px] text-muted-foreground">
              Finish setup
            </Badge>
          )}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{bot.preview ?? ' '}</span>
      </span>
    </button>
  )
}
