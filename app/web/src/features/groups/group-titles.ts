import type { BotView, GroupView } from '@/state/types'

/** Crew title, else the Hermes display name, else the handle. */
export function memberTitle(group: GroupView, bots: readonly BotView[], memberId: string): string {
  const member = group.members.find(m => m.memberId === memberId)
  const bot = member ? bots.find(b => b.name === member.profile) : undefined
  return bot?.title ?? member?.displayName ?? member?.handle ?? memberId
}
