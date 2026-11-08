import { Button } from '@/components/ui/button'
import type { PanelTab } from '@/features/panel/BotPanel'
import { BotAvatar } from '@/features/roster/BotAvatar'
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
      <BotAvatar bot={bot} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{bot.title}</h2>
        {!stale && <p className="text-xs text-muted-foreground">{STATUS_TEXT[bot.status]}</p>}
      </div>
      {cost !== null && <span className="text-xs text-muted-foreground">≈ ${cost.toFixed(2)} (estimate)</span>}
      {onPanel && (['routines', 'profile'] as const).map(tab => (
        <Button key={tab} type="button" size="sm" variant={panel === tab ? 'secondary' : 'ghost'} aria-pressed={panel === tab} onClick={() => onPanel(tab)}>
          {tab === 'routines' ? 'Routines' : 'Profile'}
        </Button>
      ))}
    </header>
  )
}
