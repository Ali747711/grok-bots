import { type ReactNode, useState } from 'react'

import { Settings } from 'lucide-react'

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DEFAULT_MAX_WORKING_BOTS } from '@/features/chat/disabled-reason'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { CreditPillView, useUsage } from '@/features/usage/CreditPill'
import { cn } from '@/lib/utils'
import type { BotStatus, BotView, CrewState } from '@/state/types'

import { BotAvatar } from './BotAvatar'
import { HermesBanner } from './HermesBanner'

interface SidebarProps {
  state: CrewState | null
  selected: string | null
  onSelect: (name: string) => void
  /** Browser-to-Crew stream is up; false makes the roster stale like an offline Hermes. */
  crewConnected?: boolean
  onNeedsYou?: () => void
  /** Shows the "+ New bot" button when given. */
  onNewBot?: () => void
}

const DOT: Record<BotStatus, string> = { idle: '#a8a29e', working: '#2563eb', needs_you: '#d97706' }

function SectionLabel({ children }: { children: string }) {
  return <div className="px-2 pt-3.5 pb-1 text-[11px] font-medium tracking-wider text-muted-foreground uppercase">{children}</div>
}

function BotRow({ bot, active, showStatus, onSelect }: { bot: BotView; active: boolean; showStatus: boolean; onSelect: (name: string) => void }) {
  return (
    <button
      type="button"
      data-bot={bot.name}
      aria-current={active ? 'true' : undefined}
      onClick={() => onSelect(bot.name)}
      className={cn('flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left hover:bg-secondary', active && 'bg-secondary')}
    >
      <BotAvatar bot={bot}>
        {showStatus && (
          <span
            data-testid={`status-${bot.name}`}
            data-status={bot.status}
            className="absolute -right-0.5 -bottom-0.5 size-[11px] rounded-full border-2 border-background"
            style={{ backgroundColor: DOT[bot.status] }}
          />
        )}
      </BotAvatar>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-sm font-semibold">{bot.title}</span>
          {bot.setupIncomplete && <span className="shrink-0 rounded-full bg-secondary px-1.5 text-[10px] font-medium text-muted-foreground">Finish setup</span>}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{bot.preview ?? ' '}</span>
      </span>
    </button>
  )
}

function HiddenSection({ bots, row }: { bots: readonly BotView[]; row: (bot: BotView) => ReactNode }) {
  if (bots.length === 0) return null
  return (
    <Collapsible>
      <CollapsibleTrigger className="w-full px-2 pt-3.5 pb-1 text-left text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        {`Hidden (${bots.length})`}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1">{bots.map(row)}</CollapsibleContent>
    </Collapsible>
  )
}

/** New-bot button, credit pill, settings gear and dialog. Polls credit once and shares it with both. */
function SidebarFooter({ onNewBot, maxWorkingBots }: { onNewBot?: () => void; maxWorkingBots: number | null }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const usage = useUsage()
  return (
    <>
      {onNewBot && (
        <button type="button" onClick={onNewBot} className="mt-2 rounded-[10px] p-2 text-left text-sm font-medium hover:bg-secondary">
          + New bot
        </button>
      )}
      <div className="flex items-center gap-2 pt-2">
        <CreditPillView usage={usage} />
        <button
          type="button"
          aria-label="Settings"
          onClick={() => setSettingsOpen(true)}
          className="ml-auto rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
        >
          <Settings className="size-4" />
        </button>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} maxWorkingBots={maxWorkingBots} usage={usage} />
    </>
  )
}

/** Roster: Needs-you row, the primary bot and the rest. Dimmed with statuses hidden while Hermes is not connected. */
export function Sidebar({ state, selected, onSelect, crewConnected = true, onNeedsYou, onNewBot }: SidebarProps) {
  const bots = (state?.bots ?? []).filter(b => !b.hidden)
  const hidden = (state?.bots ?? []).filter(b => b.hidden)
  const stale = state !== null && (state.hermes !== 'connected' || !crewConnected)
  const primary = bots.filter(b => b.isPrimary)
  const others = bots.filter(b => !b.isPrimary)
  const needsYou = state?.pending.length ?? 0
  const row = (bot: BotView) => <BotRow key={bot.name} bot={bot} active={bot.name === selected} showStatus={!stale} onSelect={onSelect} />

  return (
    <>
      <div className="px-2 pt-1 pb-3 text-base font-bold tracking-tight">Crew</div>
      {state && <HermesBanner hermes={state.hermes} crewConnected={crewConnected} />}
      <button type="button" onClick={onNeedsYou} className="flex w-full items-center gap-2.5 rounded-[10px] p-2 text-left text-sm hover:bg-secondary">
        <span>Needs you</span>
        {needsYou > 0 && (
          <span data-testid="needs-you-count" className="ml-auto rounded-full bg-[#d97706] px-[7px] text-[11px] font-semibold text-white">
            {needsYou}
          </span>
        )}
      </button>
      <div data-testid="roster" data-stale={stale} className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto', stale && 'opacity-50')}>
        {primary.length > 0 && (
          <section role="group" aria-label="Primary" className="flex flex-col gap-1">
            <SectionLabel>Primary</SectionLabel>
            {primary.map(row)}
          </section>
        )}
        {others.length > 0 && (
          <section role="group" aria-label="Bots" className="flex flex-col gap-1">
            <SectionLabel>Bots</SectionLabel>
            {others.map(row)}
          </section>
        )}
        <HiddenSection bots={hidden} row={row} />
      </div>
      <SidebarFooter onNewBot={onNewBot} maxWorkingBots={state?.settings ? state.settings.maxWorkingBots : DEFAULT_MAX_WORKING_BOTS} />
    </>
  )
}
