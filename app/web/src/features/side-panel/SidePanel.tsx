import { CalendarClock, Monitor, X } from 'lucide-react'

import type { SidePanelTab } from '@/app/panel-params'
import { IconButton } from '@/components/console/icon-button'
import { SegmentedTabs, type TabItem } from '@/components/console/segmented-tabs'
import { ComputerPanel } from '@/features/computer/ComputerPanel'
import { PanelBoundary } from '@/features/panel/PanelBoundary'
import { RoutinesPanel } from '@/features/routines/RoutinesPanel'
import type { BotView } from '@/state/types'

const TABS: TabItem<SidePanelTab>[] = [
  { id: 'computer', label: 'Screen', icon: Monitor },
  { id: 'routines', label: 'Routines', icon: CalendarClock }
]
const ID_PREFIX = 'side'

interface SidePanelProps {
  bot: BotView
  tab: SidePanelTab
  /** A tab was picked (the caller keeps the choice in `?panel=`). */
  onTab: (tab: SidePanelTab) => void
  onClose: () => void
}

/**
 * The panel beside a bot's conversation: its screen or its routines. Only the open tab's body is
 * mounted, so leaving Screen (another tab, Close, another bot) unmounts the viewer, which hands
 * control back if the user holds it (spec §6.3).
 */
export function SidePanel({ bot, tab, onTab, onClose }: SidePanelProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-none items-center gap-2 p-3">
        <SegmentedTabs tabs={TABS} value={tab} onChange={onTab} label={`${bot.title}'s panel`} idPrefix={ID_PREFIX} />
        {/* The link chip ("Live", "You're in control") goes here. */}
        <div data-slot="side-chip" className="flex min-w-0 flex-1 justify-end" />
        <IconButton label="Close panel" onClick={onClose}><X /></IconButton>
      </header>
      <div role="tabpanel" id={`${ID_PREFIX}-panel`} aria-labelledby={`${ID_PREFIX}-tab-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PanelBoundary key={`${bot.name}-${tab}`}>
          {tab === 'computer' ? <ComputerPanel key={bot.name} bot={bot} /> : <RoutinesPanel key={bot.name} bot={bot} />}
        </PanelBoundary>
      </div>
    </div>
  )
}
