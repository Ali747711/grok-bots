/** Where a bot's "Right now" block lives (live facts 2026-11-12: `agent.system_prompt` reaches Bot Chat and rooms). */
export type RightNowCarrier = 'system_prompt' | 'soul'
export const RIGHT_NOW_CARRIER: RightNowCarrier = 'system_prompt'

// Innermost complete block: a lone open marker in the owner's text never swallows what follows it.
const NOW_BODY = '<!-- crew:now -->(?:(?!<!-- crew:now -->)[\\s\\S])*?<!-- \\/crew:now -->'
const NOW_RE = new RegExp(NOW_BODY)
const NOW_RE_ALL = new RegExp(`(?:\\n\\n)?${NOW_BODY}`, 'g')

/** The owner's prompt with Crew's block in it: the first complete block is replaced, other copies dropped. */
export function mergeNowBlock(prompt: string, block: string): string {
  const owner = withoutNowBlock(prompt)
  return owner === '' ? block : `${owner}\n\n${block}`
}

/** The prompt without Crew's blocks (each with the blank line before it); owner text stays byte-identical. */
export function withoutNowBlock(prompt: string): string {
  return NOW_RE.test(prompt) ? prompt.replace(NOW_RE_ALL, '') : prompt
}

// Port of HA/hermes_cli/personality.py:16-115 (Hermes 2bd378ed): neutral names, built-ins, user overlays.
const NEUTRAL = new Set(['', 'none', 'default', 'neutral'])
const BUILTIN = new Set(['catgirl', 'concise', 'creative', 'helpful', 'hype', 'kawaii', 'noir', 'philosopher', 'pirate',
  'shakespeare', 'surfer', 'teacher', 'technical', 'uwu'])

const dict = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** The personality Hermes would apply (it replaces `agent.system_prompt`), or '' for none. */
export function activePersonality(raw: unknown): string {
  const cfg = dict(raw)
  const name = String(dict(cfg.display).personality ?? '').trim().toLowerCase()
  if (NEUTRAL.has(name)) return ''
  const user = [dict(cfg.personalities), dict(dict(cfg.agent).personalities)].flatMap(Object.keys).map(k => k.trim().toLowerCase())
  return BUILTIN.has(name) || user.includes(name) ? name : ''
}

/** The Soul carries the block when a personality would hide the system prompt, or that key is not plain text. */
export function carrierFor(raw: unknown, base: RightNowCarrier = RIGHT_NOW_CARRIER): RightNowCarrier {
  if (base === 'soul' || activePersonality(raw) !== '') return 'soul'
  const prompt = dict(dict(raw).agent).system_prompt
  return prompt !== undefined && prompt !== null && typeof prompt !== 'string' ? 'soul' : 'system_prompt'
}
