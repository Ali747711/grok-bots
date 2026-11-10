import { Button } from '@/components/ui/button'
import type { CrewState } from '@/state/types'

import { ConnectionChip } from './ConnectionChip'
import { railSummary } from './rail-sections'

interface RailHeaderProps {
  state: CrewState | null
  crewConnected: boolean
  /** Statuses are shown (the rail is not stale). */
  showStatus: boolean
  onNewBot: () => void
}

/** "Crew", how many bots there are and how many work, the connection chip and the New bot button. */
export function RailHeader({ state, crewConnected, showStatus, onNewBot }: RailHeaderProps) {
  return (
    <header className="flex flex-col gap-2 px-2 pt-0.5 pb-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-[15px] leading-5 font-semibold tracking-tight">Crew</h1>
          {state && <p className="truncate text-xs font-medium text-faint tabular-nums">{railSummary(state.bots, showStatus)}</p>}
        </div>
        <Button type="button" size="sm" onClick={onNewBot} className="rounded-full font-semibold">
          + New bot
        </Button>
      </div>
      {state && (
        <div className="flex empty:hidden">
          <ConnectionChip hermes={state.hermes} crewConnected={crewConnected} />
        </div>
      )}
    </header>
  )
}
