import { ArrowLeft } from 'lucide-react'

import { IconButton } from '@/components/console/icon-button'
import { ProfilePanel } from '@/features/bots/ProfilePanel'
import type { BotView } from '@/state/types'

interface ProfilePageProps {
  bot: BotView
  /** Leave the profile for the bot's conversation. */
  onBack: () => void
}

/** A bot's profile in the work area, in place of its conversation: a header with Back, then the profile form. */
export function ProfilePage({ bot, onBack }: ProfilePageProps) {
  return (
    <>
      <header className="flex flex-none items-center gap-2 border-b border-border px-3 py-3">
        <IconButton label="Back to chat" shortcut="Esc" side="bottom" onClick={onBack}><ArrowLeft /></IconButton>
        <h2 className="min-w-0 truncate text-[15px] font-semibold">{bot.title}</h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[720px]">
          <ProfilePanel bot={bot} />
        </div>
      </div>
    </>
  )
}
