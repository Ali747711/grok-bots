// Copied from the server (bots/names.ts) so the dialog validates exactly what the server will; the web never imports server code.

export const PROFILE_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/
export const RESERVED_NAMES = ['hermes', 'default', 'test', 'tmp', 'root', 'sudo'] as const

function slugify(value: string, max = 64): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
}

/** NFC, Latin accents fold, every other letter/digit becomes a `-u<hex>-` token, cut at 64 on a token boundary. */
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

/** Strict: callers pass the final handle, nothing is normalized. */
export function validateBotName(name: string): NameCheck {
  if (!name) return { ok: false, reason: 'empty' }
  if (!PROFILE_NAME_RE.test(name)) return { ok: false, reason: 'format' }
  if ((RESERVED_NAMES as readonly string[]).includes(name)) return { ok: false, reason: 'reserved' }
  return { ok: true }
}

export const NAME_MESSAGES: Record<'empty' | 'format' | 'reserved', string> = {
  empty: 'Enter a name',
  format: 'Use lowercase letters, numbers, - and _ (start with a letter or number)',
  reserved: 'That handle is reserved'
}
