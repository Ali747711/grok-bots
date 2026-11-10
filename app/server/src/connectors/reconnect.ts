import { withBotLock } from '../bots/bot-lock.js'
import { log } from '../log.js'
import { reloadMcp, setAppsServerEnabled, type Hermes } from './hermes-mcp.js'
import type { RECONNECT } from './policy.js'
import { RECONNECT as DEFAULT_RECIPE } from './policy.js'

export interface Reconnector {
  schedule(bot: string): void
  /** Resolves once no run is active or queued for the bot. */
  idle(bot: string): Promise<void>
}

interface Deps {
  readonly hermes: Hermes
  readonly wanted: (bot: string) => boolean
  readonly sleep: (ms: number) => Promise<void>
  readonly recipe?: typeof RECONNECT
}

interface Run { enabled: boolean; again: boolean; done: Promise<void> }

/**
 * R6: Hermes ignores an edited live server, so a changed tool list needs the server torn down and
 * rebuilt. Disable, wait out the gap, enable. Runs are coalesced per bot: a schedule before the enable
 * step is already covered by it, one after queues exactly one more run.
 */
export function createReconnector(deps: Deps): Reconnector {
  const recipe = deps.recipe ?? DEFAULT_RECIPE
  const runs = new Map<string, Run>()

  const toggle = async (bot: string, enabled: boolean): Promise<void> => {
    const step = enabled ? 'enable' : 'disable'
    try {
      await withBotLock(bot, () => setAppsServerEnabled(deps.hermes, bot, enabled))
    } catch (error) {
      log.warn('apps reconnect step failed', { bot, step, error: error instanceof Error ? error.name : 'unknown' })
    }
  }

  // The check shares the lock with the PUT: a turn-off or key removal holding the lock cannot be
  // undone by an enable that was queued behind it.
  const enableIfWanted = async (bot: string): Promise<boolean> => {
    try {
      return await withBotLock(bot, async () => {
        if (!deps.wanted(bot)) return false
        await setAppsServerEnabled(deps.hermes, bot, true)
        return true
      })
    } catch (error) {
      log.warn('apps reconnect step failed', { bot, step: 'enable', error: error instanceof Error ? error.name : 'unknown' })
      return false
    }
  }

  const once = async (bot: string, run: Run): Promise<void> => {
    run.enabled = false
    await toggle(bot, false)
    if (recipe.nudge) await reloadMcp(deps.hermes, bot, false)
    await deps.sleep(recipe.gapMs)
    run.enabled = true
    if (await enableIfWanted(bot)) {
      if (recipe.nudge) await reloadMcp(deps.hermes, bot, true)
    }
  }

  const loop = async (bot: string, run: Run): Promise<void> => {
    do {
      run.again = false
      run.enabled = false
      try {
        await once(bot, run)
      } catch (error) {
        log.warn('apps reconnect step failed', { bot, step: 'run', error: error instanceof Error ? error.name : 'unknown' })
      }
    } while (run.again)
    runs.delete(bot)
  }

  return {
    schedule(bot) {
      const active = runs.get(bot)
      if (active) {
        if (active.enabled) active.again = true
        return
      }
      const run: Run = { enabled: false, again: false, done: Promise.resolve() }
      runs.set(bot, run)
      run.done = loop(bot, run)
    },
    async idle(bot) {
      while (runs.has(bot)) await runs.get(bot)?.done
    }
  }
}
