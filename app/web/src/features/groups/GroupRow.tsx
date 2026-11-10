import { cn } from '@/lib/utils'
import type { BotView, GroupView } from '@/state/types'

import { memberTitle } from './group-titles'
import { StackedAvatars } from './StackedAvatars'

interface GroupRowProps {
  group: GroupView
  bots: readonly BotView[]
  active: boolean
  stale: boolean
  onSelect: (roomId: string) => void
}

function previewText(group: GroupView, bots: readonly BotView[], stale: boolean): string {
  const runner = group.activity.find(a => a.status !== 'queued')
  if (runner && !stale) return `${memberTitle(group, bots, runner.memberId)} is working…`
  const p = group.preview
  if (p) {
    const who = p.speaker.kind === 'user' ? 'You' : p.speaker.kind === 'member' ? memberTitle(group, bots, p.speaker.memberId) : p.speaker.label
    return `${who}: ${p.text}`
  }
  return group.members.map(m => memberTitle(group, bots, m.memberId)).join(', ')
}

/** One group in the sidebar: stacked member avatars, name, one-line preview. Matches RosterRow. */
export function GroupRow({ group, bots, active, stale, onSelect }: GroupRowProps) {
  const members = group.members.map(m => {
    const bot = bots.find(b => b.name === m.profile) ?? null
    // A stale sidebar must not show live status.
    return bot && stale ? { ...bot, status: 'idle' as const } : bot
  })
  return (
    <button
      type="button"
      data-group={group.id}
      data-selected={active ? 'true' : undefined}
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(group.id)}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-2xl p-2 text-left transition-colors hover:bg-muted',
        active && 'bg-raised hover:bg-raised'
      )}
    >
      <StackedAvatars bots={members} size={30} />
      <span className="min-w-0 flex-1">
        <span className={cn('block truncate text-sm font-semibold', active && 'text-foreground')}>{group.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{previewText(group, bots, stale)}</span>
      </span>
    </button>
  )
}
