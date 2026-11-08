import type { BotStatus, BotView } from '@/state/types'

/** The 18 `bot-avatars` types, in the library's order. Copy of the server's list (the web never imports server code). */
export const AVATAR_TYPES = [
  'clover', 'flower', 'triangle', 'square', 'blob', 'ghost', 'circle', 'drop', 'star',
  'droid', 'mech', 'alien', 'hexagon', 'cat', 'cloud', 'pill', 'pebble', 'puddle'
] as const

export type AvatarType = (typeof AVATAR_TYPES)[number]
export type AvatarState = 'default' | 'working' | 'sleeping'

const DAY_MS = 86_400_000

/** FNV-1a 32-bit over the UTF-16 code units. Same function as the server's `deriveAvatarType`. */
function hash32(handle: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < handle.length; i += 1) {
    h ^= handle.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** The type a bot gets when it never chose one. */
export const deriveAvatarType = (handle: string): AvatarType => AVATAR_TYPES[hash32(handle) % AVATAR_TYPES.length]!

/** Stable 0 <= seed < 1 so a row of bots does not blink in unison. */
export const avatarSeed = (handle: string): number => hash32(handle) / 2 ** 32

/**
 * Working animates; hidden bots and bots idle for over 24 h sleep. A bot that needs you is awake.
 * `lastActive` is in seconds, `null` (a brand-new bot) is never asleep.
 */
export function avatarState(bot: { status: BotStatus; hidden: boolean; lastActive: number | null }, now: number): AvatarState {
  if (bot.hidden) return 'sleeping'
  if (bot.status === 'working') return 'working'
  if (bot.status === 'needs_you') return 'default'
  return bot.lastActive !== null && now - bot.lastActive * 1000 > DAY_MS ? 'sleeping' : 'default'
}

export type ResolvedAvatar = { kind: 'photo' } | { kind: 'avatar'; type: AvatarType; color?: string }

/** A photo only for an uploaded one (`imageKind === 'photo'`); otherwise the chosen or derived avatar. */
export function resolvedAvatar(bot: Pick<BotView, 'name' | 'avatar' | 'imageKind' | 'hasAvatar'>): ResolvedAvatar {
  if (bot.imageKind === 'photo' && bot.hasAvatar) return { kind: 'photo' }
  const type = bot.avatar?.type ?? deriveAvatarType(bot.name)
  return bot.avatar?.color ? { kind: 'avatar', type, color: bot.avatar.color } : { kind: 'avatar', type }
}
