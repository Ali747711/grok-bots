export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const RESERVED_NAMES = ['hermes', 'default', 'test', 'tmp', 'root', 'sudo'] as const

/** Ported from hermes-bots/labels.ts `slugify` (Hermes 2bd378ed). */
function slugify(value: string, max = 64): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
}

/**
 * Ported from hermes-bots/labels.ts `slugifyProfileName` (Hermes 2bd378ed): NFC, Latin accents fold,
 * every other letter/digit becomes a `-u<hex>-` token, cut at 64 on a token boundary.
 */
export function slugifyProfileName(value: string): string {
  const folded = value
    .normalize('NFC')
    .replace(/[\p{L}\p{N}]/gu, ch => {
      const base = ch.normalize('NFKD').replace(/\p{M}+/gu, '')
      return /^[a-zA-Z0-9]+$/.test(base) ? base : `-u${ch.codePointAt(0)!.toString(16)}-`
    })
    .replace(/-+/g, '-')
  const slug = slugify(folded, Infinity)
  if (slug.length <= 64) return slug
  const cut = slug.slice(0, 64)
  const boundary = slug[64] === '-' ? 64 : cut.lastIndexOf('-')
  return (boundary > 0 ? cut.slice(0, boundary) : cut).replace(/-+$/, '')
}

export type NameCheck = { ok: true } | { ok: false; reason: 'empty' | 'format' | 'reserved' }

/** Mirrors the server: strip + lowercase, then the id regex, then the reserved list. */
export function validateBotName(name: string): NameCheck {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return { ok: false, reason: 'empty' }
  if (!PROFILE_NAME_RE.test(normalized)) return { ok: false, reason: 'format' }
  if ((RESERVED_NAMES as readonly string[]).includes(normalized)) return { ok: false, reason: 'reserved' }
  return { ok: true }
}
