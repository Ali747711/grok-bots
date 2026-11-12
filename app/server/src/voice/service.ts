import { withBotLock } from '../bots/bot-lock.js'
import type { BotDeps } from '../bots/create.js'
import { readRawConfig, writeConfig } from '../bots/sandbox.js'
import { readSoulFile, writeSoulFile } from '../bots/soul-io.js'
import { SOUL_VERSION, composeSoul, hasHouseBlock, nowOf, ownerPartOf } from '../bots/soul.js'
import { applyVoiceSettings, resetMemory } from './bot-settings.js'
import { gatherFacts, type FactsDeps } from './facts.js'
import { carrierFor, mergeNowBlock, withoutNowBlock } from './now-block.js'
import { buildRightNow } from './right-now.js'
import { createScheduler } from './scheduler.js'
import type { VoiceStore } from './voice-store.js'

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
  readonly store: VoiceStore
  inScope(bot: string): boolean
  beforeFirstPass?(names: readonly string[]): Promise<void>
}

export interface VoiceService {
  /** A bot's facts (or, without a bot, everyone's) may have changed: refresh after a short debounce. */
  changed(bot?: string): void
  /** Crew just created this bot: its cloned memory is emptied on the next prepare. */
  markNew(bot: string): Promise<void>
  /** Memory reset (new bots only), voice settings, then the bot's own block. The caller holds the bot lock. */
  prepare(bot: string): Promise<void>
  /** The bot was deleted: drop its record. */
  forget(bot: string): Promise<void>
  /** Gets voice upkeep: the configured scope, or any bot Crew already prepared (it has a voice record). */
  inScope(bot: string): boolean
  start(): void
  stop(): void
}

async function prepareBot(deps: VoiceServiceDeps, bot: string): Promise<void> {
  if (deps.store.get(bot)?.resetPending) {
    await resetMemory(deps.bots, bot)
    await deps.store.set(bot, { resetPending: false })
  }
  await applyVoiceSettings(deps.bots, bot)
  await refreshRightNow(deps, bot)
  await deps.store.set(bot, { soulVersion: SOUL_VERSION })
}

/** Keeps every in-scope bot's "Right now" block current; each refresh runs under that bot's lock. */
export function createVoiceService(deps: VoiceServiceDeps): VoiceService {
  let scheduler: ReturnType<typeof createScheduler> | null = null
  const inScope = (bot: string): boolean => deps.inScope(bot) || deps.store.get(bot)?.soulVersion !== undefined
  return {
    inScope,
    changed: bot => scheduler?.schedule(bot),
    markNew: bot => deps.store.set(bot, { resetPending: true }),
    prepare: bot => prepareBot(deps, bot),
    forget: bot => deps.store.remove(bot),
    start() {
      scheduler ??= createScheduler({
        delayMs: DELAY_MS,
        sweepMs: SWEEP_MS,
        names: () => deps.roster().map(b => b.name),
        inScope,
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
