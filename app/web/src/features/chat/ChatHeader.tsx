import { Button } from '@/components/ui/button'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import type { PanelTab } from '@/features/panel/BotPanel'
import { cn } from '@/lib/utils'
import type { BotStatus, BotView } from '@/state/types'

import { useSessionCost } from './use-session-cost'

const STATUS_TEXT: Record<BotStatus, string> = { idle: 'Idle', working: 'Working', needs_you: 'Needs you' }

/** Bot avatar, name and live status. `stale` hides the status (it may be out of date). */
interface ChatHeaderProps {
  bot: BotView
  stale: boolean
  /** The open panel tab; with `onPanel` the header shows the Routines and Profile buttons. */
  panel?: PanelTab | null
  onPanel?: (tab: PanelTab) => void
}

export function ChatHeader({ bot, stale, panel = null, onPanel }: ChatHeaderProps) {
  const cost = useSessionCost(bot.sessionId, bot.name, bot.status)
  return (
    <header className="flex items-center gap-3 border-b border-border px-5 py-3">
      <CrewAvatar bot={stale ? { ...bot, status: 'idle' } : bot} size={40} decorative />
      <div className="min-w-24 flex-1">
        <h2 className="truncate text-sm font-semibold">{bot.title}</h2>
        {!stale && (
          <p className={cn('label-mono mt-0.5', bot.status === 'working' && 'text-sky-ink')}>
            <span aria-hidden="true">● </span>
            {STATUS_TEXT[bot.status]}
          </p>
        )}
      </div>
      {cost !== null && <span className="min-w-0 truncate text-xs text-muted-foreground">≈ ${cost.toFixed(2)} (estimate)</span>}
      {onPanel && (['routines', 'profile'] as const).map(tab => (
        <Button
          key={tab}
          type="button"
          size="sm"
          variant={panel === tab ? 'default' : 'outline'}
          aria-pressed={panel === tab}
          onClick={() => onPanel(tab)}
          className={cn('rounded-full', panel === tab && 'border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background')}
        >
          {tab === 'routines' ? 'Routines' : 'Profile'}
        </Button>
      ))}
    </header>
  )
}
