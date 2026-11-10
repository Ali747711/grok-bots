import { log } from '../log.js'

import type { BotDeps } from './create.js'

/** Ask for a roster refresh; a failure is logged and never stops the caller. */
export async function refreshQuietly(deps: Pick<BotDeps, 'refresh'>): Promise<void> {
  await deps.refresh().catch((error: unknown) => {
    log.warn('roster refresh failed', { error: (error instanceof Error ? error.message : String(error)).slice(0, 200) })
  })
}
