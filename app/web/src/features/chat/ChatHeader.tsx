import { CalendarClock, Monitor, UserRound } from 'lucide-react'
import type { ReactNode } from 'react'

import type { BotPanel } from '@/app/panel-params'
import { IconButton } from '@/components/console/icon-button'
import { StatusChip } from '@/components/console/status'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { SandboxBadge } from '@/features/bots/SandboxBadge'
import { ScreenThumbnail } from '@/features/computer/ScreenThumbnail'
import { modShortcut } from '@/hooks/use-window-keydown'
import type { BotView } from '@/state/types'

import { headerMeta } from './model-name'
import { useSessionCost } from './use-session-cost'

interface PanelButton {
  tab: BotPanel
  label: string
  icon: ReactNode
  shortcut?: string
}

// Icon buttons, not text: beside a side panel the conversation is about 460 px wide and the title needs the room.
const PANEL_BUTTONS: readonly PanelButton[] = [
  { tab: 'computer', label: 'Computer', icon: <Monitor />, shortcut: modShortcut('\\') },
  { tab: 'routines', label: 'Routines', icon: <CalendarClock /> },
  { tab: 'profile', label: 'Profile', icon: <UserRound /> }
]

/** Bot avatar, name, meta line and live status. `stale` hides the status (it may be out of date). */
interface ChatHeaderProps {
  bot: BotView
  stale: boolean
  /** The open panel. With `onPanel` the header shows the Computer, Routines and Profile buttons. */
  panel: BotPanel | null
  /** A button was clicked: the panel to show next, or null when the open one was clicked again. */
  onPanel?: (next: BotPanel | null) => void
}

export function ChatHeader({ bot, stale, panel, onPanel }: ChatHeaderProps) {
  const cost = useSessionCost(bot.sessionId, bot.name, bot.status)
  const meta = headerMeta(bot, cost)
  const sideOpen = panel === 'computer' || panel === 'routines'
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 py-2 pr-3 pl-4">
      <CrewAvatar bot={stale ? { ...bot, status: 'idle' } : bot} size={32} decorative />
      <div className="min-w-24 flex-1 pl-1">
        <div className="flex items-center gap-1.5">
          <h2 className="min-w-0 text-[15px] leading-5 font-semibold tracking-tight">
            {onPanel ? (
              // The bot's identity is the way into its profile.
              <button
                type="button"
                title={`Open ${bot.title}'s profile`}
                onClick={() => onPanel('profile')}
                className="block max-w-full truncate rounded-md text-left outline-none hover:underline hover:underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring"
              >
                {bot.title}
              </button>
            ) : (
              <span className="block truncate">{bot.title}</span>
            )}
          </h2>
          {bot.sandbox === 'on' && <SandboxBadge />}
        </div>
        {meta !== '' && <p className="truncate text-xs leading-4 font-medium text-faint">{meta}</p>}
      </div>
      {!stale && <StatusChip status={bot.status} />}
      {onPanel && <ScreenThumbnail bot={bot} hidden={sideOpen} onOpen={() => onPanel('computer')} />}
      {onPanel && (
        <div className="flex shrink-0 items-center gap-0.5">
          {PANEL_BUTTONS.map(({ tab, label, icon, shortcut }) => (
            <IconButton key={tab} label={label} shortcut={shortcut} side="bottom" pressed={panel === tab} onClick={() => onPanel(panel === tab ? null : tab)}>
              {icon}
            </IconButton>
          ))}
        </div>
      )}
    </header>
  )
}
