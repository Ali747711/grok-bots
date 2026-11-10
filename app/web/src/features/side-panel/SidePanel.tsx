import { CalendarClock, Monitor, X } from 'lucide-react'
import { useState } from 'react'
import { createPortal } from 'react-dom'

import type { SidePanelTab } from '@/app/panel-params'
import { IconButton } from '@/components/console/icon-button'
import { SegmentedTabs, type TabItem } from '@/components/console/segmented-tabs'
import { PanelBoundary } from '@/features/panel/PanelBoundary'
import { RoutinesPanel } from '@/features/routines/RoutinesPanel'
import type { BotView } from '@/state/types'

import { ComputerProvider, useComputerContext } from './ComputerProvider'
import { LinkChip } from './LinkChip'
import { ScreenTab } from './ScreenTab'

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
 * The link chip, drawn into the header's slot from inside the computer's provider. A portal, so the
 * header never remounts when the tab changes (a tab picked with the keyboard keeps focus) while the
 * chip still lives and dies with the viewer.
 */
function HeaderChip({ slot }: { slot: HTMLElement | null }) {
  const { screen, live } = useComputerContext()
  if (!slot) return null
  return createPortal(<LinkChip kind={screen.view.kind} link={live.link} control={screen.view.control} />, slot)
}

/**
 * The panel beside a bot's conversation: its screen or its routines. Only the open tab's body is
 * mounted, and the computer (screen state, viewer, link chip) only for the Screen tab, so leaving
 * Screen (another tab, Close, another bot) unmounts the viewer, which hands control back if the
 * user holds it (spec §6.3).
 */
export function SidePanel({ bot, tab, onTab, onClose }: SidePanelProps) {
  const [chipSlot, setChipSlot] = useState<HTMLElement | null>(null)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 flex-none items-center gap-2 px-3">
        <SegmentedTabs tabs={TABS} value={tab} onChange={onTab} label={`${bot.title}'s panel`} idPrefix={ID_PREFIX} />
        <div ref={setChipSlot} data-slot="side-chip" className="flex min-w-0 flex-1 justify-end" />
        <IconButton label="Close panel" onClick={onClose}><X /></IconButton>
      </header>
      <div role="tabpanel" id={`${ID_PREFIX}-panel`} aria-labelledby={`${ID_PREFIX}-tab-${tab}`} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <PanelBoundary key={`${bot.name}-${tab}`}>
          {tab === 'computer' ? (
            <ComputerProvider key={bot.name} bot={bot}>
              <HeaderChip slot={chipSlot} />
              <ScreenTab bot={bot} />
            </ComputerProvider>
          ) : <RoutinesPanel key={bot.name} bot={bot} />}
        </PanelBoundary>
      </div>
    </div>
  )
}
