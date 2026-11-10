import { Badge } from '@/components/ui/badge'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { SandboxBadge } from '@/features/bots/SandboxBadge'
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
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(bot.name)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-2xl p-2 text-left transition-colors hover:bg-muted',
        active && 'bg-sky-soft shadow-[inset_3px_0_0_var(--sky)] hover:bg-sky-soft'
      )}
    >
      {/* A stale roster must not show live status, so the avatar sees an idle copy (hidden/old bots still sleep). */}
      <CrewAvatar bot={showStatus ? bot : { ...bot, status: 'idle' }} size={36} decorative />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn('truncate text-sm font-semibold', active && 'text-sky-ink')}>{bot.title}</span>
          {bot.sandbox === 'on' && <SandboxBadge />}
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
