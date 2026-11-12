import { log } from '../log.js'
import type { GroupsState } from '../groups/types.js'
import type { BotView } from '../watcher/bot-state.js'

export interface SchedulerDeps {
  readonly delayMs: number
  readonly sweepMs: number
  names(): readonly string[]
  inScope(bot: string): boolean
  run(bot: string): Promise<void>
  beforeFirstPass?(names: readonly string[]): Promise<void>
}

/**
 * Debounced, sequential refreshes: `schedule(bot?)` adds one bot (or every in-scope bot) and arms one timer.
 * A periodic sweep catches what no trigger reports (routines a bot made itself, a Composio key change).
 */
export function createScheduler(deps: SchedulerDeps): { schedule(bot?: string): void; stop(): void } {
  const pending = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const ready = deps.beforeFirstPass ? deps.beforeFirstPass(deps.names()).catch(error => {
    log.warn('voice first pass failed', { error: error instanceof Error ? error.name : 'unknown' })
  }) : Promise.resolve()

  async function flush(): Promise<void> {
    timer = null
    await ready
    for (const bot of [...pending]) {
      pending.delete(bot)
      if (stopped) return
      try {
        await deps.run(bot)
      } catch (error) {
        log.warn('right-now write failed', { bot, error: error instanceof Error ? error.name : 'unknown' })
      }
    }
  }

  function schedule(bot?: string): void {
    if (stopped) return
    for (const name of bot === undefined ? deps.names() : [bot]) if (deps.inScope(name)) pending.add(name)
    if (pending.size > 0 && timer === null) timer = setTimeout(() => void flush(), deps.delayMs)
  }

  const sweep = setInterval(() => schedule(), deps.sweepMs)
  return {
    schedule,
    stop() {
      stopped = true
      clearInterval(sweep)
      if (timer) clearTimeout(timer)
    }
  }
}

/** What the blocks of every bot depend on in the roster and rooms; a status change leaves it unchanged. */
export function rosterFingerprint(bots: readonly BotView[], groups: GroupsState): string {
  return JSON.stringify([
    bots.map(b => [b.name, b.title, b.role, b.job, b.hidden, b.isPrimary, b.sandbox]),
    groups.rooms.map(r => [r.id, r.name, r.purpose, r.members.map(m => m.profile)])
  ])
}
