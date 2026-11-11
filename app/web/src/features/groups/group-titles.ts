import type { BotView, GroupView } from '@/state/types'

/** Crew title, else the Hermes display name, else the handle. */
export function memberTitle(group: GroupView, bots: readonly BotView[], memberId: string): string {
  const member = group.members.find(m => m.memberId === memberId)
  const bot = member ? bots.find(b => b.name === member.profile) : undefined
  return bot?.title ?? member?.displayName ?? member?.handle ?? memberId
}

/** "A", "A and B", "A, B and C". */
export const joinAnd = (parts: readonly string[]): string =>
  parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]!}`

/** The handle a bot gets in a group (the server's `handleFor`): the default bot answers to @hermes, the others to their profile name. */
export const groupHandle = (profile: string): string => (profile === 'default' ? 'hermes' : profile)
