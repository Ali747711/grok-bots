import { PanelRight, Square } from 'lucide-react'

import { IconButton } from '@/components/console/icon-button'
import { StatusChip } from '@/components/console/status'
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

/**
 * The conversation header for a group, in the bot header's layout: stacked avatars, name,
 * "<n> bots · <rule> replies", then the Working chip and Stop while the group works, and Details.
 */
export function GroupHeader({ group, bots, stale, panelOpen, onPanel, onStop }: GroupHeaderProps) {
  const members = group.members.map(m => {
    const bot = bots.find(b => b.name === m.profile) ?? null
    return bot && stale ? { ...bot, status: 'idle' as const } : bot
  })
  const working = group.working && !stale
  return (
    <header className="flex min-h-14 shrink-0 items-center gap-2 py-2 pr-3 pl-4">
      <StackedAvatars bots={members} size={32} />
      <div className="min-w-24 flex-1 pl-1">
        <h2 className="truncate text-[15px] leading-5 font-semibold tracking-tight">{group.name}</h2>
        <p className="truncate text-xs leading-4 font-medium text-faint">{`${group.members.length} bots · ${ROUTING_LABEL[group.routing]} replies`}</p>
      </div>
      {working && <StatusChip status="working" />}
      <div className="flex shrink-0 items-center gap-0.5">
        {working && (
          <IconButton label="Stop" side="bottom" onClick={onStop}>
            <Square className="size-3" fill="currentColor" aria-hidden="true" />
          </IconButton>
        )}
        <IconButton label="Details" side="bottom" pressed={panelOpen} onClick={onPanel}>
          <PanelRight aria-hidden="true" />
        </IconButton>
      </div>
    </header>
  )
}
