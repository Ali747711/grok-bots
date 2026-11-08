import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { log } from '../log.js'

export const MAX_WORKING_BOTS_RANGE = { min: 1, max: 20 } as const

export interface CrewSettings {
  /** Integer 1-20, or null for no limit. */
  readonly maxWorkingBots: number | null
}

export const DEFAULT_SETTINGS: CrewSettings = { maxWorkingBots: 2 }

export const settingsPatchSchema = z.object({
  maxWorkingBots: z.number().int().min(MAX_WORKING_BOTS_RANGE.min).max(MAX_WORKING_BOTS_RANGE.max).nullable()
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
      const parsed = settingsPatchSchema.safeParse(JSON.parse(raw))
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
