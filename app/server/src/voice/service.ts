import { withBotLock } from '../bots/bot-lock.js'
import type { BotDeps } from '../bots/create.js'
import { readRawConfig, writeConfig } from '../bots/sandbox.js'
import { readSoulFile, writeSoulFile } from '../bots/soul-io.js'
import { composeSoul, hasHouseBlock, nowOf, ownerPartOf } from '../bots/soul.js'
import { gatherFacts, type FactsDeps } from './facts.js'
import { carrierFor, mergeNowBlock, withoutNowBlock } from './now-block.js'
import { buildRightNow } from './right-now.js'
import { createScheduler } from './scheduler.js'

export type WriteOutcome = 'written' | 'unchanged' | 'waiting_for_migration'

const promptOf = (raw: Record<string, unknown>): unknown => ((raw.agent ?? {}) as Record<string, unknown>).system_prompt

async function writePrompt(deps: Pick<BotDeps, 'rest'>, bot: string, current: unknown, next: string): Promise<boolean> {
  if (typeof current === 'string' ? current === next : next === '') return false
  await writeConfig(deps, bot, { agent: { system_prompt: next } })
  return true
}

/**
 * Put `block` where Hermes will read it, and take any copy out of the other place. Never writes
 * `display.personality`. The caller holds the bot lock.
 */
export async function writeRightNow(deps: Pick<BotDeps, 'rest'>, bot: string, block: string): Promise<WriteOutcome> {
  const raw = await readRawConfig(deps, bot)
  const soul = await readSoulFile(deps, bot)
  const prompt = promptOf(raw)
  if (carrierFor(raw) === 'soul') {
    if (!hasHouseBlock(soul)) return 'waiting_for_migration'
    const nextSoul = composeSoul(ownerPartOf(soul), block)
    const soulChanged = nextSoul !== soul
    if (soulChanged) await writeSoulFile(deps, bot, nextSoul)
    const promptChanged = typeof prompt === 'string' && await writePrompt(deps, bot, prompt, withoutNowBlock(prompt))
    return soulChanged || promptChanged ? 'written' : 'unchanged'
  }
  const promptChanged = await writePrompt(deps, bot, prompt, mergeNowBlock(typeof prompt === 'string' ? prompt : '', block))
  const soulCopy = nowOf(soul) !== null
  if (soulCopy) await writeSoulFile(deps, bot, composeSoul(ownerPartOf(soul)))
  return promptChanged || soulCopy ? 'written' : 'unchanged'
}

/** Gather the facts, build the block and write it. The caller holds the bot lock. */
export async function refreshRightNow(deps: FactsDeps, bot: string): Promise<WriteOutcome> {
  return writeRightNow(deps.bots, bot, buildRightNow(await gatherFacts(deps, bot)))
}

const DELAY_MS = 3000
const SWEEP_MS = 10 * 60_000

export interface VoiceServiceDeps extends FactsDeps {
  inScope(bot: string): boolean
  beforeFirstPass?(names: readonly string[]): Promise<void>
}

export interface VoiceService {
  /** A bot's facts (or, without a bot, everyone's) may have changed: refresh after a short debounce. */
  changed(bot?: string): void
  start(): void
  stop(): void
}

/** Keeps every in-scope bot's "Right now" block current; each refresh runs under that bot's lock. */
export function createVoiceService(deps: VoiceServiceDeps): VoiceService {
  let scheduler: ReturnType<typeof createScheduler> | null = null
  return {
    changed: bot => scheduler?.schedule(bot),
    start() {
      scheduler ??= createScheduler({
        delayMs: DELAY_MS,
        sweepMs: SWEEP_MS,
        names: () => deps.roster().map(b => b.name),
        inScope: deps.inScope,
        run: bot => withBotLock(bot, async () => { await refreshRightNow(deps, bot) }),
        ...(deps.beforeFirstPass ? { beforeFirstPass: deps.beforeFirstPass } : {})
      })
    },
    stop() {
      scheduler?.stop()
      scheduler = null
    }
  }
}
