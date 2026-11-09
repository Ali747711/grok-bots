import type { HermesRest } from '../hermes/rest-client.js'
import { createHookHandler, type HookHandler } from './hook-handler.js'
import { createLimiter, DEFAULT_LIMITS } from './limits.js'
import { createTriggerRunner, type TriggerRunner } from './runner.js'
import type { TriggerStore } from './store.js'

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
