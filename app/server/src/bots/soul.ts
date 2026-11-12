import { HOUSE_TEXT } from '../voice/copy.js'

/**
 * A bot's SOUL.md = the owner's part (exactly what the Soul tab shows and edits) + one Crew house block.
 * The house block is fixed text between markers; a bot on the Soul carrier also keeps its "Right now"
 * block inside it (spec 2026-11-12 §4.1, §8).
 */
export const SOUL_VERSION = 1
export const HOUSE_OPEN = `<!-- crew:house v${SOUL_VERSION} -->`
export const HOUSE_CLOSE = '<!-- /crew:house -->'
export const NOW_OPEN = '<!-- crew:now -->'
export const NOW_CLOSE = '<!-- /crew:now -->'

export interface SoulInput {
  readonly name: string
  readonly title: string
  readonly mission: string
}

/**
 * Innermost complete house block of any version, with the blank line (or newline) before it and the
 * newline after. A lone open marker earlier in the text never swallows owner text.
 */
const HOUSE_BLOCK_RE = /(?:\n\n|\n)?<!-- crew:house v(\d+) -->(?:(?!<!-- crew:house v)[\s\S])*?<!-- \/crew:house -->\n?/g
const NOW_BLOCK_RE = /<!-- crew:now -->[\s\S]*?<!-- \/crew:now -->/

/** Ported from hermes-bots/labels.ts `displayName` fallback: Title-cased name (Hermes 2bd378ed). */
function displayName(name: string, title: string): string {
  const t = title.trim()
  if (t) return t
  return name.replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, ch => ch.toUpperCase())
}

/** The owner's part Crew writes for a new bot: a header and, when given, the mission line. */
export function newOwnerPart({ name, title, mission }: SoulInput): string {
  const header = `# ${displayName(name, title)}`
  return mission.trim() ? `${header}\n\n**Mission:** ${mission}` : header
}

export function houseBlock(now?: string): string {
  return [HOUSE_OPEN, HOUSE_TEXT, ...(now ? ['', now] : []), HOUSE_CLOSE].join('\n')
}

export function composeSoul(ownerPart: string, now?: string): string {
  return `${ownerPart === '' ? '' : `${ownerPart}\n\n`}${houseBlock(now)}\n`
}

/** The Soul minus every complete house block; whatever else is in the file belongs to the owner. */
export function ownerPartOf(soul: string): string {
  // A block between two pieces of owner text (a hand edit) leaves one newline so the pieces stay apart.
  return soul.replace(HOUSE_BLOCK_RE, (match: string, _version: string, offset: number, whole: string) => {
    const next = whole[offset + match.length]
    return offset === 0 || next === undefined || next === '\n' ? '' : '\n'
  })
}

/** The "Right now" block kept inside the house area (Soul carrier only), or null. */
export function nowOf(soul: string): string | null {
  for (const block of soul.match(HOUSE_BLOCK_RE) ?? []) {
    const now = NOW_BLOCK_RE.exec(block)
    if (now) return now[0]
  }
  return null
}

export function hasHouseBlock(soul: string, version: number = SOUL_VERSION): boolean {
  return [...soul.matchAll(HOUSE_BLOCK_RE)].some(m => Number(m[1]) === version)
}
