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

/** Accessory values of `bot-avatars` 0.2.2 (BotAvatarFace / Hat / Glasses). */
export const AVATAR_FACES = ['eyes', 'mouth'] as const
export const AVATAR_HATS = ['none', 'beret', 'beanie', 'party', 'crown'] as const
export const AVATAR_GLASSES = ['none', 'round', 'square', 'shades'] as const

export type AvatarFace = (typeof AVATAR_FACES)[number]
export type AvatarHat = (typeof AVATAR_HATS)[number]
export type AvatarGlasses = (typeof AVATAR_GLASSES)[number]

export interface CrewAvatar {
  readonly type: AvatarType
  /** `#rrggbb`; the type's default colour when absent. */
  readonly color?: string
  readonly face?: AvatarFace
  readonly hat?: AvatarHat
  readonly glasses?: AvatarGlasses
  readonly headphones?: boolean
  readonly bowTie?: boolean
}

const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** Request-body schema for an avatar. */
export const crewAvatarSchema = z.object({
  type: z.enum(AVATAR_TYPES),
  color: z.string().regex(COLOR_RE).optional(),
  face: z.enum(AVATAR_FACES).optional(),
  hat: z.enum(AVATAR_HATS).optional(),
  glasses: z.enum(AVATAR_GLASSES).optional(),
  headphones: z.boolean().optional(),
  bowTie: z.boolean().optional()
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

const oneOf = <T extends string>(list: readonly T[], value: unknown): T | undefined =>
  typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : undefined

/** The valid accessories among the stored keys; an invalid one is dropped, never the whole avatar. */
function readAccessories(raw: Record<string, unknown>): Omit<CrewAvatar, 'type' | 'color'> {
  const face = oneOf(AVATAR_FACES, raw.face)
  const hat = oneOf(AVATAR_HATS, raw.hat)
  const glasses = oneOf(AVATAR_GLASSES, raw.glasses)
  return {
    ...(face ? { face } : {}),
    ...(hat ? { hat } : {}),
    ...(glasses ? { glasses } : {}),
    ...(typeof raw.headphones === 'boolean' ? { headphones: raw.headphones } : {}),
    ...(typeof raw.bowTie === 'boolean' ? { bowTie: raw.bowTie } : {})
  }
}

/** A stored `crewAvatar` when valid, else null. Never throws. */
export function readCrewAvatar(value: unknown): CrewAvatar | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const { type, color } = raw
  if (typeof type !== 'string' || !(AVATAR_TYPES as readonly string[]).includes(type)) return null
  if (color !== undefined && !(typeof color === 'string' && COLOR_RE.test(color))) return null
  return { type: type as AvatarType, ...(color !== undefined ? { color: color as string } : {}), ...readAccessories(raw) }
}
