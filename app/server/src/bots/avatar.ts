import { z } from 'zod'

/** The 18 `bot-avatars` types, in the library's order. */
export const AVATAR_TYPES = [
  'clover', 'flower', 'triangle', 'square', 'blob', 'ghost', 'circle', 'drop', 'star',
  'droid', 'mech', 'alien', 'hexagon', 'cat', 'cloud', 'pill', 'pebble', 'puddle'
] as const

export type AvatarType = (typeof AVATAR_TYPES)[number]

/** Copied from the library's `botAvatarPalette`; the web test asserts equality. */
export const AVATAR_DEFAULT_COLORS: Readonly<Record<AvatarType, string>> = {
  clover: '#41C4FF',
  flower: '#2FCB7A',
  triangle: '#DC48FF',
  square: '#35B8FF',
  blob: '#2FCB7A',
  ghost: '#F4F2FA',
  circle: '#9A62FF',
  drop: '#1ED3C6',
  star: '#EFDB8E',
  droid: '#D5DBEA',
  mech: '#95A6C4',
  alien: '#9CD66A',
  hexagon: '#EB7575',
  cat: '#EAA06F',
  cloud: '#CFD5E4',
  pill: '#ACAAF3',
  pebble: '#ABC793',
  puddle: '#EE8BDB'
}

export interface CrewAvatar {
  readonly type: AvatarType
  /** `#rrggbb`; the type's default colour when absent. */
  readonly color?: string
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** Request-body schema for an avatar. */
export const crewAvatarSchema = z.object({
  type: z.enum(AVATAR_TYPES),
  color: z.string().regex(COLOR_RE).optional()
})

/** FNV-1a 32-bit over the UTF-16 code units, modulo the type count. Copied verbatim by the web. */
export function deriveAvatarType(handle: string): AvatarType {
  let h = 0x811c9dc5
  for (let i = 0; i < handle.length; i += 1) {
    h ^= handle.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return AVATAR_TYPES[h % AVATAR_TYPES.length]!
}

const HERMES_SHAPES: Partial<Record<AvatarType, string>> = {
  circle: 'circle', square: 'squircle', triangle: 'triangle', hexagon: 'hexagon',
  cloud: 'cloud', drop: 'drop', pill: 'pill', blob: 'blob'
}

/** The nearest shape the official Hermes client draws for this type. */
export const hermesShapeFor = (type: AvatarType): string => HERMES_SHAPES[type] ?? 'blob'

/** What to write into `hermes-bots` so the official client shows a matching shape and colour. */
export function avatarMetaPatch(avatar: CrewAvatar): { crewAvatar: CrewAvatar; shape: string; color: string; custom: true } {
  return {
    crewAvatar: avatar,
    shape: hermesShapeFor(avatar.type),
    color: avatar.color ?? AVATAR_DEFAULT_COLORS[avatar.type],
    custom: true
  }
}

/** A stored `crewAvatar` when valid, else null. Never throws. */
export function readCrewAvatar(value: unknown): CrewAvatar | null {
  if (!value || typeof value !== 'object') return null
  const { type, color } = value as Record<string, unknown>
  if (typeof type !== 'string' || !(AVATAR_TYPES as readonly string[]).includes(type)) return null
  if (color === undefined) return { type: type as AvatarType }
  return typeof color === 'string' && COLOR_RE.test(color) ? { type: type as AvatarType, color } : null
}
