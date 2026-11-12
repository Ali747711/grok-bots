import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { IANAZone } from 'luxon'
import { z } from 'zod'

import { log } from '../log.js'

export const MAX_WORKING_BOTS_RANGE = { min: 1, max: 20 } as const

export const OWNER_NAME_MAX = 60

export interface CrewSettings {
  /** Integer 1-20, or null for no limit. */
  readonly maxWorkingBots: number | null
  /** What the bots call the owner (spec 2026-11-12 §4.2); shared by every bot. */
  readonly ownerName: string | null
  /** IANA zone the bots use for the owner's time, taken from the browser on the first save. */
  readonly timeZone: string | null
}

export const DEFAULT_SETTINGS: CrewSettings = { maxWorkingBots: 2, ownerName: null, timeZone: null }

const maxWorkingBots = z.number().int().min(MAX_WORKING_BOTS_RANGE.min).max(MAX_WORKING_BOTS_RANGE.max).nullable()
// No line breaks or angle brackets: the name goes into every bot's prompt, one line, never a marker.
const ownerName = z.string().trim().max(OWNER_NAME_MAX).regex(/^[^\r\n<>]*$/).transform(v => v || null).nullable()
const timeZone = z.string().max(64).refine(zone => IANAZone.isValidZone(zone)).nullable()

export const settingsPatchSchema = z.object({ maxWorkingBots, ownerName, timeZone }).partial().strict()
  .refine(patch => Object.keys(patch).length > 0)

/** The file on disk: an older file has only `maxWorkingBots`, so the new keys default to null. */
const settingsFileSchema = z.object({
  maxWorkingBots,
  ownerName: ownerName.optional().default(null),
  timeZone: timeZone.optional().default(null)
})

/** Crew's own preferences, kept in `<stateDir>/settings.json` (0600, written tmp + rename). */
export class SettingsStore {
  private readonly listeners = new Set<() => void>()
  private writing: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly file: string,
    private current: CrewSettings
  ) {}

  /** Load the file; a missing file gives defaults, a corrupt one gives defaults plus one warning. */
  static async load(file: string): Promise<SettingsStore> {
    let current = DEFAULT_SETTINGS
    try {
      const raw = await readFile(file, 'utf8')
      const parsed = settingsFileSchema.safeParse(JSON.parse(raw))
      if (parsed.success) current = parsed.data
      else log.warn('settings file invalid, using defaults', { file })
    } catch (error) {
      if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        log.warn('settings file unreadable, using defaults', { file, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return new SettingsStore(file, current)
  }

  get(): CrewSettings {
    return this.current
  }

  /** Persist the merged settings, then notify listeners. Concurrent updates apply in call order. */
  update(patch: Partial<CrewSettings>): Promise<CrewSettings> {
    const run = this.writing.then(async () => {
      const next: CrewSettings = { ...this.current, ...patch }
      await this.persist(next)
      this.current = next
      for (const listener of [...this.listeners]) listener()
      return next
    })
    this.writing = run.catch(() => undefined)
    return run
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  private async persist(next: CrewSettings): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(next) + '\n', { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
  }
}
