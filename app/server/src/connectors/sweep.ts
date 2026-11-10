import { log } from '../log.js'

/** R10: a bot must stay missing for at least this long, across two roster syncs, before its apps are forgotten. */
export const SWEEP_GRACE_MS = 30_000

export interface OrphanSweep {
  onRoster(names: readonly string[]): void
  /** Resolves when every forget started so far has settled (tests). */
  idle(): Promise<void>
}

export interface SweepDeps {
  readonly bots: () => readonly string[]
  readonly forget: (bot: string) => Promise<void>
  readonly now: () => number
}

/** Forgets the apps of bots deleted outside Crew. An empty roster is ignored and a bot that reappears resets. */
export function createOrphanSweep(deps: SweepDeps, graceMs: number = SWEEP_GRACE_MS): OrphanSweep {
  const missingSince = new Map<string, number>()
  const inFlight = new Map<string, Promise<void>>()

  const forget = (bot: string): void => {
    missingSince.delete(bot)
    const run = deps.forget(bot).catch(error => {
      log.warn('orphan sweep failed', { bot, error: error instanceof Error ? error.name : 'unknown' })
    }).finally(() => { inFlight.delete(bot) })
    inFlight.set(bot, run)
  }

  return {
    onRoster(names) {
      if (names.length === 0) return
      const present = new Set(names)
      const orphans = new Set(deps.bots().filter(bot => !present.has(bot)))
      for (const bot of [...missingSince.keys()]) if (!orphans.has(bot)) missingSince.delete(bot)
      const at = deps.now()
      for (const bot of orphans) {
        if (inFlight.has(bot)) continue
        const since = missingSince.get(bot)
        if (since === undefined) missingSince.set(bot, at)
        else if (at - since >= graceMs) forget(bot)
      }
    },
    async idle() {
      await Promise.all([...inFlight.values()])
    }
  }
}
