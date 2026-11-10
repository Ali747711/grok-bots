import { motion } from 'motion/react'

import { slide } from '@/lib/motion'
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

/** One group in the rail: stacked member avatars, name, one-line preview. A 48 px pill like the bot rows. */
export function GroupRow({ group, bots, active, stale, onSelect }: GroupRowProps) {
  const members = group.members.map(m => {
    const bot = bots.find(b => b.name === m.profile) ?? null
    // A stale rail must not show live status.
    return bot && stale ? { ...bot, status: 'idle' as const } : bot
  })
  return (
    <button
      type="button"
      data-group={group.id}
      data-rail-row=""
      aria-current={active ? 'page' : undefined}
      onClick={() => onSelect(group.id)}
      className={cn(
        'relative flex h-12 w-full items-center gap-2.5 rounded-full py-1.5 pr-3 pl-2 text-left transition-[background-color,opacity] outline-none focus-visible:ring-3 focus-visible:ring-ring',
        !active && 'hover:bg-hover',
        stale && 'opacity-50'
      )}
    >
      {/* The same pill as the bot rows, so it slides between a bot and a group. */}
      {active && <motion.span layoutId="rail-active" transition={slide} className="absolute inset-0 rounded-full bg-raised" />}
      <span className="relative flex shrink-0">
        <StackedAvatars bots={members} size={30} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-[18px] font-semibold">{group.name}</span>
        <span className="block truncate text-xs leading-4 font-medium text-muted-foreground">{previewText(group, bots, stale)}</span>
      </span>
    </button>
  )
}
