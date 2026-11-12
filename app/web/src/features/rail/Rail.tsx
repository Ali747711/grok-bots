import { type ReactNode, type RefObject, useRef, useState } from 'react'

import { Search } from 'lucide-react'
import { LayoutGroup } from 'motion/react'

import { Kbd } from '@/components/console/kbd'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Skeleton } from '@/components/ui/skeleton'
import { DEFAULT_MAX_WORKING_BOTS } from '@/features/chat/disabled-reason'
import { GroupsSection } from '@/features/groups/GroupsSection'
import { modShortcut } from '@/hooks/use-window-keydown'
import type { BotView, CrewState } from '@/state/types'

import { RailFooter } from './RailFooter'
import { RailHeader } from './RailHeader'
import { RailRow } from './RailRow'
import { matchesFind, railSections } from './rail-sections'
import { moveBetweenRows, useFocusAfterMove, useRailKeys } from './use-rail-keys'

export interface RailProps {
  state: CrewState | null
  /** Browser-to-Crew stream is up; false makes the rail stale like an offline Hermes. */
  crewConnected: boolean
  selected: string | null
  selectedGroupId: string | null
  /** The Needs-you page is open. */
  needsYouActive: boolean
  onSelect(name: string): void
  onSelectGroup(id: string): void
  onNeedsYou(): void
  onNewGroup(): void
}

const LABEL = 'text-xs font-semibold text-faint'

interface SectionProps {
  name: string
  /** Sits at the end of the header line. */
  action?: ReactNode
  children?: ReactNode
}

function Section({ name, action, children }: SectionProps) {
  return (
    <section role="group" aria-label={name} className="flex flex-col gap-0.5">
      <div className="flex h-7 items-center justify-between px-2">
        <span className={LABEL}>{name}</span>
        {action}
      </div>
      {children}
    </section>
  )
}

interface HiddenProps {
  count: number
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}

function HiddenSection({ count, open, onOpenChange, children }: HiddenProps) {
  const name = `Hidden (${count})`
  return (
    <section role="group" aria-label={name}>
      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleTrigger className={`${LABEL} flex h-7 w-full items-center rounded-full px-2 text-left outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring`}>
          {name}
        </CollapsibleTrigger>
        <CollapsibleContent className="flex flex-col gap-0.5">{children}</CollapsibleContent>
      </Collapsible>
    </section>
  )
}

function RailSkeleton() {
  return (
    <div className="flex flex-col gap-0.5 pt-3" aria-hidden="true">
      {[0, 1, 2, 3].map(i => (
        <div key={i} data-testid="roster-skeleton" className="flex h-12 items-center gap-2.5 px-2">
          <Skeleton className="size-8 rounded-xl" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-36" />
          </div>
        </div>
      ))}
    </div>
  )
}

function EmptyRail({ onNewBot }: { onNewBot: () => void }) {
  return (
    <div className="flex flex-col items-start gap-2 p-2 pt-4 text-sm">
      <p className="font-medium">No bots yet</p>
      <p className="text-xs text-muted-foreground">Create one to give it a job and start chatting.</p>
      <Button type="button" size="sm" className="rounded-full" onClick={onNewBot}>New bot</Button>
    </div>
  )
}

interface FindProps {
  inputRef: RefObject<HTMLInputElement | null>
  query: string
  onQuery: (query: string) => void
}

function Find({ inputRef, query, onQuery }: FindProps) {
  return (
    <label className="mx-1 flex h-9 flex-none items-center gap-2 rounded-full bg-background pr-2 pl-3 transition-shadow focus-within:ring-3 focus-within:ring-ring">
      <Search className="size-4 shrink-0 text-faint" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={event => onQuery(event.target.value)}
        placeholder="Find a bot"
        aria-label="Find a bot"
        autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
      />
      <Kbd>{modShortcut('K')}</Kbd>
    </label>
  )
}

/**
 * The Crew rail: header and connection chip, Find, the bots in Needs you / Pinned / Crew, the groups,
 * the hidden bots, and the footer. While Hermes or the Crew stream is down, rows dim and hide live status.
 */
export function Rail({ state, crewConnected, selected, selectedGroupId, needsYouActive, onSelect, onSelectGroup, onNeedsYou, onNewGroup }: RailProps) {
  const [query, setQuery] = useState('')
  const [newBotOpen, setNewBotOpen] = useState(false)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  const findRef = useRef<HTMLInputElement>(null)
  const stale = state !== null && (state.hermes !== 'connected' || !crewConnected)
  const showStatus = !stale
  const finding = query.trim() !== ''
  const sections = railSections((state?.bots ?? []).filter(bot => matchesFind(bot, query)), showStatus)
  const requests = state?.pending.length ?? 0
  const visible = [...sections.needsYou, ...sections.pinned, ...sections.crew, ...(hiddenOpen ? sections.hidden : [])]
  const onMoved = useFocusAfterMove(state?.bots)
  useRailKeys({ findRef, visible: visible.map(bot => bot.name), onSelect })

  const row = (bot: BotView) => <RailRow key={bot.name} bot={bot} active={bot.name === selected} showStatus={showStatus} onSelect={onSelect} onMoved={onMoved} />
  const openAll = requests > 0 && (
    <button
      type="button"
      aria-current={needsYouActive ? 'page' : undefined}
      onClick={onNeedsYou}
      className="rounded-full px-1.5 text-xs font-medium text-muted-foreground underline-offset-2 outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring aria-[current=page]:text-foreground"
    >
      {`Open all (${requests})`}
    </button>
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <RailHeader state={state} crewConnected={crewConnected} showStatus={showStatus} newBotOpen={newBotOpen} onNewBotOpen={setNewBotOpen} onCreated={onSelect} />
      <Find inputRef={findRef} query={query} onQuery={setQuery} />
      {state === null && <RailSkeleton />}
      <div onKeyDown={moveBetweenRows} className="-mx-1 flex min-h-0 flex-1 scroll-thin flex-col gap-3 overflow-y-auto px-1 pt-3 pb-1">
        <LayoutGroup id="crew-rail">
          {state !== null && !stale && state.bots.length === 0 && <EmptyRail onNewBot={() => setNewBotOpen(true)} />}
          {(sections.needsYou.length > 0 || requests > 0) && <Section name="Needs you" action={openAll}>{sections.needsYou.map(row)}</Section>}
          {sections.pinned.length > 0 && <Section name="Pinned">{sections.pinned.map(row)}</Section>}
          {sections.crew.length > 0 && <Section name="Crew">{sections.crew.map(row)}</Section>}
          {state?.groups && !finding && <GroupsSection state={state} selectedGroupId={selectedGroupId} stale={stale} onSelect={onSelectGroup} onNewGroup={onNewGroup} />}
          {sections.hidden.length > 0 && (
            <HiddenSection count={sections.hidden.length} open={hiddenOpen} onOpenChange={setHiddenOpen}>
              {sections.hidden.map(row)}
            </HiddenSection>
          )}
          {finding && visible.length === 0 && sections.hidden.length === 0 && <p className="px-2 py-6 text-center text-[13px] font-medium text-faint">No bot matches</p>}
        </LayoutGroup>
      </div>
      <RailFooter bots={state?.bots ?? []} maxWorkingBots={state?.settings ? state.settings.maxWorkingBots : DEFAULT_MAX_WORKING_BOTS} />
    </div>
  )
}
