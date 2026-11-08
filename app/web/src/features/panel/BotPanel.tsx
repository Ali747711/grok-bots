import { ProfilePanel } from '@/features/bots/ProfilePanel'
import type { BotView } from '@/state/types'

export type PanelTab = 'routines' | 'profile'

export const isPanelTab = (v: string | null): v is PanelTab => v === 'routines' || v === 'profile'

/** Right-hand panel for one bot. The tab is chosen by the caller (the `?panel=` search param). */
export function BotPanel({ bot, tab }: { bot: BotView; tab: PanelTab }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <h3 className="border-b border-border px-4 py-3 text-sm font-semibold">{tab === 'profile' ? 'Profile' : 'Routines'}</h3>
      {tab === 'profile' ? <ProfilePanel key={bot.name} bot={bot} /> : <p className="p-4 text-sm text-muted-foreground">Routines will appear here.</p>}
    </div>
  )
}
