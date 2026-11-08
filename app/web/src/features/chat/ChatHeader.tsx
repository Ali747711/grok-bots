import { BotAvatar } from '@/features/roster/BotAvatar'
import type { BotStatus, BotView } from '@/state/types'

const STATUS_TEXT: Record<BotStatus, string> = { idle: 'Idle', working: 'Working', needs_you: 'Needs you' }

/** Bot avatar, name and live status. `stale` hides the status (it may be out of date). */
export function ChatHeader({ bot, stale }: { bot: BotView; stale: boolean }) {
  return (
    <header className="flex items-center gap-3 border-b border-border px-5 py-3">
      <BotAvatar bot={bot} />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-sm font-semibold">{bot.title}</h2>
        {!stale && <p className="text-xs text-muted-foreground">{STATUS_TEXT[bot.status]}</p>}
      </div>
    </header>
  )
}
