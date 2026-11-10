import { Button } from '@/components/ui/button'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import type { BotView } from '@/state/types'

interface EmptyThreadProps {
  bot: BotView
  /** Opens the bot's profile. */
  onProfile: () => void
}

/** What a conversation shows before its first message: the bot, and the way into its profile. */
export function EmptyThread({ bot, onProfile }: EmptyThreadProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <CrewAvatar bot={{ ...bot, status: 'idle' }} size={64} decorative />
      <p className="text-[15px] font-semibold tracking-tight">Start with {bot.title}</p>
      <Button type="button" variant="outline" size="sm" onClick={onProfile}>
        {bot.setupIncomplete ? 'Finish setup' : 'Set up profile'}
      </Button>
    </div>
  )
}
