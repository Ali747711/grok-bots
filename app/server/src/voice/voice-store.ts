import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import { z } from 'zod'

import { log } from '../log.js'

/** What Crew remembers per bot about its voice upkeep. Kept by Crew, not in `ui_meta`, which clones copy. */
export interface VoiceRecord {
  /** The house-block version this bot was last migrated or prepared to. */
  readonly soulVersion?: number
  /** Created by Crew and not yet emptied: the next prepare resets its cloned memory. */
  readonly resetPending?: boolean
}

const recordSchema = z.object({ soulVersion: z.number().int().optional(), resetPending: z.boolean().optional() })
const fileSchema = z.object({ bots: z.record(z.string(), recordSchema) })

/** `<stateDir>/voice.json` (0600, written tmp + rename, one write at a time). */
export class VoiceStore {
  private writing: Promise<unknown> = Promise.resolve()

  private constructor(private readonly file: string, private bots: Readonly<Record<string, VoiceRecord>>) {}

  /** A missing file is empty; a corrupt one is empty plus one warning. */
  static async load(file: string): Promise<VoiceStore> {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(await readFile(file, 'utf8')))
      if (parsed.success) return new VoiceStore(file, parsed.data.bots)
      log.warn('voice file invalid, starting empty', { file })
    } catch (error) {
      if (!(error instanceof Error && (error as NodeJS.ErrnoException).code === 'ENOENT')) {
        log.warn('voice file unreadable, starting empty', { file, error: error instanceof Error ? error.name : 'unknown' })
      }
    }
    return new VoiceStore(file, {})
  }

  get(bot: string): VoiceRecord | undefined {
    return Object.hasOwn(this.bots, bot) ? this.bots[bot] : undefined
  }

  set(bot: string, patch: VoiceRecord): Promise<void> {
    return this.queue(() => ({ ...this.bots, [bot]: { ...this.get(bot), ...patch } }))
  }

  remove(bot: string): Promise<void> {
    return this.queue(() => Object.fromEntries(Object.entries(this.bots).filter(([name]) => name !== bot)))
  }

  private queue(next: () => Readonly<Record<string, VoiceRecord>>): Promise<void> {
    const run = this.writing.then(async () => {
      const bots = next()
      await this.persist(bots)
      this.bots = bots
    })
    this.writing = run.catch(() => undefined)
    return run
  }

  private async persist(bots: Readonly<Record<string, VoiceRecord>>): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true, mode: 0o700 })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify({ bots }) + '\n', { mode: 0o600 })
    await chmod(tmp, 0o600)
    await rename(tmp, this.file)
  }
}
