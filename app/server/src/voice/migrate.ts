import { constants } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'

import { withBotLock } from '../bots/bot-lock.js'
import type { BotDeps } from '../bots/create.js'
import { readBotDetail } from '../bots/edit.js'
import { readSoulFile, writeSoulFile } from '../bots/soul-io.js'
import { SOUL_VERSION, composeSoul, hasHouseBlock, newOwnerPart, nowOf, ownerPartOf } from '../bots/soul.js'
import { log } from '../log.js'
import { applyVoiceSettings } from './bot-settings.js'
import { isHermesStockSoul } from './hermes-stock-souls.js'
import type { VoiceStore } from './voice-store.js'

export type MigrationReason = 'kept' | 'crew_template' | 'hermes_stock' | 'empty'

// The two sentences of Crew's old `composeSoul` template: Crew wrote them, the owner did not.
const OLD_TEMPLATE = [
  /^You are .+, a persistent named agent \(profile `[^`]+`\) on this machine\.$/,
  /^You keep your own memory, skills, and conversation history across sessions\.$/
]

/** Drop the old template lines; collapse only the blank-line runs that removal created. */
function withoutOldTemplate(owner: string): string | null {
  const lines = owner.split('\n')
  const kept: string[] = []
  let removed = false
  // Only blank lines right after a removed sentence are dropped; the owner's own spacing elsewhere stays.
  let justRemoved = false
  for (const line of lines) {
    if (OLD_TEMPLATE.some(re => re.test(line))) {
      removed = true
      justRemoved = true
      continue
    }
    if (line === '' && justRemoved && kept.at(-1) === '') continue
    if (line !== '') justRemoved = false
    kept.push(line)
  }
  return removed ? kept.join('\n').replace(/\n+$/, '') : null
}

/** What stays the owner's part after the migration (spec 2026-11-12 §4.6, §8). */
export function migratedOwnerPart(soul: string, bot: { title: string; job: string }): { owner: string; reason: MigrationReason } {
  const owner = ownerPartOf(soul)
  const fresh = newOwnerPart({ name: bot.title, title: bot.title, mission: bot.job })
  if (isHermesStockSoul(owner)) return { owner: fresh, reason: 'hermes_stock' }
  if (owner.trim() === '') return { owner: fresh, reason: 'empty' }
  const cleaned = withoutOldTemplate(owner)
  return cleaned === null ? { owner, reason: 'kept' } : { owner: cleaned, reason: 'crew_template' }
}

/** Write a backup that never replaces another: `<bot>-<date>.md`, then `-2`, `-3` … (0600, dir 0700). */
export async function backupSoul(dir: string, bot: string, date: string, content: string): Promise<string> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  for (let n = 1; ; n += 1) {
    const path = join(dir, `${bot}-${date}${n === 1 ? '' : `-${n}`}.md`)
    try {
      const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600)
      try {
        await file.writeFile(content)
      } finally {
        await file.close()
      }
      return path
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
}

export interface MigrationDeps {
  readonly bots: BotDeps
  readonly store: VoiceStore
  readonly backupDir: string
  now(): number
  refreshNow(bot: string): Promise<unknown>
}

async function migrateLocked(deps: MigrationDeps, bot: string, step: { name: string }): Promise<'migrated' | 'current'> {
  step.name = 'read'
  const raw = await readSoulFile(deps.bots, bot)
  if (deps.store.get(bot)?.soulVersion === SOUL_VERSION && hasHouseBlock(raw)) return 'current'
  step.name = 'backup'
  if (raw !== '') await backupSoul(deps.backupDir, bot, new Date(deps.now()).toISOString().slice(0, 10), raw)
  step.name = 'settings'
  await applyVoiceSettings(deps.bots, bot)
  step.name = 'soul'
  const detail = await readBotDetail(deps.bots, bot)
  const { owner } = migratedOwnerPart(raw, { title: detail.title, job: detail.description })
  const next = composeSoul(owner, nowOf(raw) ?? undefined)
  if (next !== raw) await writeSoulFile(deps.bots, bot, next)
  step.name = 'right_now'
  await deps.refreshNow(bot)
  step.name = 'record'
  await deps.store.set(bot, { soulVersion: SOUL_VERSION })
  return 'migrated'
}

/**
 * Back up and rewrite one bot into the new Soul, once. Never uses a model; the owner's Soul is never
 * changed before its backup exists, and a failure leaves no record so the next start retries.
 */
export function migrateBot(deps: MigrationDeps, bot: string): Promise<'migrated' | 'current' | 'failed'> {
  const step = { name: 'read' }
  return withBotLock(bot, () => migrateLocked(deps, bot, step)).catch(error => {
    log.warn('soul migration failed', { bot, step: step.name, error: error instanceof Error ? error.name : 'unknown' })
    return 'failed' as const
  })
}

/** One bot at a time, in the order given (the in-scope roster). */
export async function migrateAll(deps: MigrationDeps, bots: readonly string[]): Promise<void> {
  for (const bot of bots) await migrateBot(deps, bot)
}
