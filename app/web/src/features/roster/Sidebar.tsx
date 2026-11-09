import type { ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { DEFAULT_MAX_WORKING_BOTS } from '@/features/chat/disabled-reason'
import { GroupsSection } from '@/features/groups/GroupsSection'
import { cn } from '@/lib/utils'
import type { BotView, CrewState } from '@/state/types'

import { HermesBanner } from './HermesBanner'
import { RosterFooter } from './RosterFooter'
import { RosterRow } from './RosterRow'

interface SidebarProps {
  state: CrewState | null
  selected: string | null
  onSelect: (name: string) => void
  /** Browser-to-Crew stream is up; false makes the roster stale like an offline Hermes. */
  crewConnected?: boolean
  onNeedsYou?: () => void
  /** The Needs you page is open: the row gets the selected look. */
  needsYouActive?: boolean
  /** Shows the "+ New bot" button when given. */
  onNewBot?: () => void
  /** Groups section: the open group, opening one, and the "+" button (shown when given). */
  selectedGroupId?: string | null
  onSelectGroup?: (roomId: string) => void
  onNewGroup?: () => void
}

const noop = (): void => undefined

function SectionLabel({ children }: { children: string }) {
  return <div className="label-mono px-2 pt-3.5 pb-1">{children}</div>
}

function HiddenSection({ bots, row }: { bots: readonly BotView[]; row: (bot: BotView) => ReactNode }) {
  if (bots.length === 0) return null
  return (
    <Collapsible>
      <CollapsibleTrigger className="label-mono w-full px-2 pt-3.5 pb-1 text-left">
        {`Hidden (${bots.length})`}
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1">{bots.map(row)}</CollapsibleContent>
    </Collapsible>
  )
}

function RosterSkeleton() {
  return (
    <div className="flex flex-col gap-1 pt-3" aria-hidden="true">
      {[0, 1, 2, 3].map(i => (
        <div key={i} data-testid="roster-skeleton" className="flex items-center gap-2.5 p-2">
          <Skeleton className="size-9 rounded-xl" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-36" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyRoster({ onNewBot }: { onNewBot?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 p-2 pt-4 text-sm">
      <p className="font-medium">No bots yet</p>
      <p className="text-xs text-muted-foreground">Create one to give it a job and start chatting.</p>
      {onNewBot && <Button type="button" size="sm" className="rounded-full" onClick={onNewBot}>New bot</Button>}
    </div>
  )
}

function SidebarHeader({ onNewBot }: { onNewBot?: () => void }) {
  return (
    <div className="flex items-center justify-between px-2 pt-1 pb-3">
      <span className="text-lg font-semibold tracking-tight">Crew</span>
      {onNewBot && (
        <Button type="button" size="sm" onClick={onNewBot} className="rounded-full font-semibold">
          + New bot
        </Button>
      )}
    </div>
  )
}

interface NeedsYouRowProps {
  count: number
  active: boolean
  onClick?: () => void
}

function NeedsYouRow({ count, active, onClick }: NeedsYouRowProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-2xl p-2 text-left text-sm font-medium transition-colors hover:bg-muted',
        active && 'bg-sky-soft shadow-[inset_3px_0_0_var(--sky)] hover:bg-sky-soft'
      )}
    >
      <span>Needs you</span>
      {count > 0 && (
        <Badge data-testid="needs-you-count" className="ml-auto font-semibold">
          {count}
        </Badge>
      )}
    </button>
  )
}

interface RosterListProps {
  state: CrewState | null
  stale: boolean
  selected: string | null
  onSelect: (name: string) => void
  onNewBot?: () => void
  groups: Pick<SidebarProps, 'selectedGroupId' | 'onSelectGroup' | 'onNewGroup'>
}

/** The loading skeleton, then the empty state or the primary / other / hidden groups. */
function RosterList({ state, stale, selected, onSelect, onNewBot, groups }: RosterListProps) {
  const bots = (state?.bots ?? []).filter(b => !b.hidden)
  const hidden = (state?.bots ?? []).filter(b => b.hidden)
  const primary = bots.filter(b => b.isPrimary)
  const others = bots.filter(b => !b.isPrimary)
  const row = (bot: BotView) => <RosterRow key={bot.name} bot={bot} active={bot.name === selected} showStatus={!stale} onSelect={onSelect} />

  return (
    <>
      {state === null && <RosterSkeleton />}
      <div data-testid="roster" data-stale={stale} className={cn('flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto', stale && 'opacity-50')}>
        {state !== null && !stale && state.bots.length === 0 && <EmptyRoster onNewBot={onNewBot} />}
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
        {state?.groups && (
          <GroupsSection state={state} selectedGroupId={groups.selectedGroupId ?? null} stale={stale} onSelect={groups.onSelectGroup ?? noop} onNewGroup={groups.onNewGroup} />
        )}
        <HiddenSection bots={hidden} row={row} />
      </div>
    </>
  )
}

/** Roster: Needs-you row, the primary bot and the rest. Dimmed with statuses hidden while Hermes is not connected. */
export function Sidebar({ state, selected, onSelect, crewConnected = true, onNeedsYou, needsYouActive = false, onNewBot, selectedGroupId, onSelectGroup, onNewGroup }: SidebarProps) {
  const stale = state !== null && (state.hermes !== 'connected' || !crewConnected)
  return (
    <>
      <SidebarHeader onNewBot={onNewBot} />
      {state && <HermesBanner hermes={state.hermes} crewConnected={crewConnected} />}
      <NeedsYouRow count={state?.pending.length ?? 0} active={needsYouActive} onClick={onNeedsYou} />
      <RosterList state={state} stale={stale} selected={selected} onSelect={onSelect} onNewBot={onNewBot} groups={{ selectedGroupId, onSelectGroup, onNewGroup }} />
      <RosterFooter maxWorkingBots={state?.settings ? state.settings.maxWorkingBots : DEFAULT_MAX_WORKING_BOTS} />
    </>
  )
}
