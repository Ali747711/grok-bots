import { ArrowLeft } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { botUrl, parseProfileTab } from '@/app/panel-params'
import { IconButton } from '@/components/console/icon-button'
import { StatusChip } from '@/components/console/status'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { useBotDetail } from '@/features/bots/use-bot-detail'
import type { BotView } from '@/state/types'

import { PROFILE_TABS, ProfileBody, type ShownTab } from './ProfileBody'

interface ProfilePageProps {
  bot: BotView
  /** Leave the profile for the bot's conversation. */
  onBack: () => void
}

/** The tab `?tab=` names; one that is not built yet (Skills) shows Identity, like an unknown value (R6). */
function useProfileTab(name: string): readonly [ShownTab, (tab: ShownTab) => void] {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const asked = parseProfileTab(params.get('tab'))
  const tab = PROFILE_TABS.find(t => t.id === asked)?.id ?? 'identity'
  return [tab, next => navigate(botUrl(name, 'profile', next), { replace: true })] as const
}

/**
 * A bot's profile in the work area, in place of its conversation: a header with Back, then the tabs.
 * The app keys it by bot, so nothing typed for one bot is ever shown for another.
 */
export function ProfilePage({ bot, onBack }: ProfilePageProps) {
  const { detail, error, reload, setDetail } = useBotDetail(bot.name)
  const [tab, setTab] = useProfileTab(bot.name)
  return (
    <div className="@container/profile flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex h-14 flex-none items-center gap-2 px-3">
        <IconButton label="Back to chat" shortcut="Esc" side="bottom" onClick={onBack}><ArrowLeft /></IconButton>
        <CrewAvatar bot={bot} size={28} interactive={false} decorative />
        <h2 className="min-w-0 truncate text-[15px] font-semibold">{bot.title}</h2>
        <span className="flex-1" />
        <StatusChip status={bot.status} />
      </header>
      {detail
        ? <ProfileBody bot={bot} detail={detail} setDetail={setDetail} reload={reload} tab={tab} onTab={setTab} />
        : <p className="p-4 text-sm text-muted-foreground">{error ? 'Could not load this bot.' : 'Loading…'}</p>}
    </div>
  )
}
