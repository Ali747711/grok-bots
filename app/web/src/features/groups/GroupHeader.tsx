import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BotView, GroupView } from '@/state/types'

import { StackedAvatars } from './StackedAvatars'

const ROUTING_LABEL = { auto: 'Auto', everyone: 'Everyone', lead: 'Lead' } as const

interface GroupHeaderProps {
  group: GroupView
  bots: readonly BotView[]
  stale: boolean
  panelOpen: boolean
  onPanel: () => void
  onStop: () => void
}

/** Stacked avatars, name, "<n> bots · <rule> replies", Details and Stop (while the group works). */
export function GroupHeader({ group, bots, stale, panelOpen, onPanel, onStop }: GroupHeaderProps) {
  const members = group.members.map(m => {
    const bot = bots.find(b => b.name === m.profile) ?? null
    return bot && stale ? { ...bot, status: 'idle' as const } : bot
  })
  return (
    <header className="flex items-center gap-3 border-b border-border px-5 py-3">
      <StackedAvatars bots={members} size={34} />
      <div className="min-w-24 flex-1">
        <h2 className="truncate text-sm font-semibold">{group.name}</h2>
        <p className="text-xs font-medium text-muted-foreground mt-0.5">{`${group.members.length} bots · ${ROUTING_LABEL[group.routing]} replies`}</p>
      </div>
      {group.working && !stale && <Button type="button" size="sm" variant="outline" className="rounded-full" onClick={onStop}>Stop</Button>}
      <Button
        type="button"
        size="sm"
        variant={panelOpen ? 'default' : 'outline'}
        aria-pressed={panelOpen}
        onClick={onPanel}
        className={cn('rounded-full', panelOpen && 'border-foreground bg-foreground text-background hover:bg-foreground/90 hover:text-background')}
      >
        Details
      </Button>
    </header>
  )
}
