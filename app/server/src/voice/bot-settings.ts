import type { BotDeps } from '../bots/create.js'
import { readRawConfig, writeConfig } from '../bots/sandbox.js'
import { PLATFORM_HINT } from './copy.js'

/**
 * The only config keys Crew's voice writes: Hermes's own "memory updated" notices off (the bot mentions a
 * save itself), and the chat-app platform hint. Never `memory.*` and never toolsets (spec 2026-11-12 §4.3).
 */
export const VOICE_CONFIG = { display: { memory_notifications: 'off' }, platform_hints: { cli: { replace: PLATFORM_HINT } } } as const

const dict = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** One sparse PUT when either key differs. The caller holds the bot lock. */
export async function applyVoiceSettings(deps: Pick<BotDeps, 'rest'>, bot: string): Promise<'written' | 'unchanged'> {
  const raw = await readRawConfig(deps, bot)
  const notices = dict(raw.display).memory_notifications
  const hint = dict(dict(raw.platform_hints).cli).replace
  if (notices === 'off' && hint === PLATFORM_HINT) return 'unchanged'
  await writeConfig(deps, bot, structuredClone(VOICE_CONFIG) as unknown as Record<string, unknown>)
  return 'written'
}

/**
 * Empty a new bot's memory: a clone starts with copies of the primary's MEMORY.md and USER.md. Never the
 * primary. The caller holds the bot lock.
 */
export async function resetMemory(deps: Pick<BotDeps, 'rest'>, bot: string): Promise<void> {
  if (bot === 'default') throw new Error('the primary bot keeps its memory')
  await deps.rest.request('POST', '/api/memory/reset', { query: { profile: bot }, body: { target: 'all' } })
}
