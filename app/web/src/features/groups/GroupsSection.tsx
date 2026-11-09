import { PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import type { CrewState } from '@/state/types'

import { GroupRow } from './GroupRow'

interface GroupsSectionProps {
  state: CrewState
  selectedGroupId: string | null
  stale: boolean
  onSelect: (roomId: string) => void
  /** Shows the "+" button when given and groups are available. */
  onNewGroup?: () => void
}

/** The sidebar's Groups block: newest activity first, or a hint when empty or when Hermes has no group engine. */
export function GroupsSection({ state, selectedGroupId, stale, onSelect, onNewGroup }: GroupsSectionProps) {
  const groups = state.groups
  if (!groups) return null
  const rooms = [...groups.rooms].sort((a, b) => b.updatedAt - a.updatedAt)
  return (
    <section role="group" aria-label="Groups" className="flex flex-col gap-1">
      <div className="flex items-center justify-between pt-3.5 pr-1 pb-1 pl-2">
        <span className="label-mono">Groups</span>
        {groups.available && onNewGroup && (
          <Button type="button" variant="ghost" size="icon-xs" aria-label="New group" onClick={onNewGroup}>
            <PlusIcon />
          </Button>
        )}
      </div>
      {!groups.available ? (
        <p className="px-2 text-xs text-muted-foreground">Group chats need Hermes&apos;s group engine</p>
      ) : rooms.length === 0 ? (
        <p className="px-2 text-xs text-muted-foreground">No groups yet</p>
      ) : (
        rooms.map(room => <GroupRow key={room.id} group={room} bots={state.bots} active={room.id === selectedGroupId} stale={stale} onSelect={onSelect} />)
      )}
    </section>
  )
}
