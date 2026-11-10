import { log } from '../log.js'
import type { HermesRest } from '../hermes/rest-client.js'
import { createHookHandler, type HookHandler } from './hook-handler.js'
import { createLimiter, DEFAULT_LIMITS } from './limits.js'
import { createTriggerRunner, type TriggerRunner } from './runner.js'
import { TriggerStore } from './store.js'

/**
 * Build the runner and the hook handler over a loaded store, and resume unfinished runs once, before
 * returning: the caller starts serving /hooks only after this, so no event can race the resume.
 */
export function wireTriggers(deps: { rest: HermesRest; store: TriggerStore; now: () => number; newId: () => string }): { runner: TriggerRunner; hooks: HookHandler } {
  const runner = createTriggerRunner({ rest: deps.rest, store: deps.store, limiter: createLimiter(DEFAULT_LIMITS), now: deps.now })
  runner.resume()
  const hooks = createHookHandler({ store: deps.store, runner, now: deps.now, newId: deps.newId })
  return { runner, hooks }
}

/**
 * Load the triggers file. A file Crew cannot read (permissions, a directory, I/O) must not take the whole
 * app down in a restart loop: log once (path only) and return null, so triggers stay off and the rest works.
 */
export async function loadTriggerStore(file: string): Promise<TriggerStore | null> {
  try {
    return await TriggerStore.load(file)
  } catch (error) {
    // The code (EACCES, EISDIR, …) is enough to act on; the message could carry file contents.
    log.error('triggers file unreadable, triggers disabled', { file, code: (error as NodeJS.ErrnoException).code ?? 'unknown' })
    return null
  }
}
