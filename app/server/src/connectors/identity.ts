import { withBotLock } from '../bots/bot-lock.js'
import { log } from '../log.js'
import type { ConnectorDeps } from './bot-apps.js'
import { addAppsServer, appsServer, removeAppsServer } from './hermes-mcp.js'
import { hashToken } from './store.js'

/** A bot whose backfill failed is tried again on a later roster sync, at most this often. */
export const IDENTITY_RETRY_MS = 30_000

export interface IdentityBackfill {
  onRoster(names: readonly string[]): void
  /** Resolves when every backfill started so far has settled (tests). */
  idle(): Promise<void>
}

/**
 * Gives a bot whose `crew_apps` entry predates the identity header a new entry that carries it. A token
 * exists only in the call that minted it (R7), so the entry is replaced with a fresh one; apps, levels
 * and the Composio session are untouched. Resolves true when it replaced the entry, false when there was
 * nothing to do. A failure part-way leaves the bot refused by the relay and unmarked, so it runs again.
 */
export function ensureIdentity(deps: ConnectorDeps, bot: string): Promise<boolean> {
  return withBotLock(bot, async () => {
    const record = deps.store.record(bot)
    if (!record || record.identity === true) return false
    const server = await appsServer(deps.bots, bot)
    // A paused bot (no key) stays paused.
    const enabled = server ? server.enabled : deps.keys.get() !== null
    const token = deps.newToken()
    const rotated = { ...record, tokenHash: hashToken(token) }
    await deps.store.setRecord(bot, rotated)
    if (server) await removeAppsServer(deps.bots, bot)
    await addAppsServer(deps.bots, bot, deps.relayUrl(bot), token, enabled)
    await deps.store.setRecord(bot, { ...rotated, identity: true })
    // The live transport keeps its old headers until it rebuilds.
    if (enabled) deps.reconnector.schedule(bot)
    return true
  })
}

/**
 * The migration for bots that had apps before the identity header: on each roster sync (the first one
 * comes right after Crew connects to Hermes) every listed bot with an unmarked record is upgraded once.
 */
export function createIdentityBackfill(deps: ConnectorDeps, retryMs: number = IDENTITY_RETRY_MS): IdentityBackfill {
  const inFlight = new Map<string, Promise<void>>()
  const triedAt = new Map<string, number>()

  const start = (bot: string): void => {
    triedAt.set(bot, deps.now())
    const run = ensureIdentity(deps, bot).then(
      changed => {
        triedAt.delete(bot)
        if (changed) log.info('apps identity added', { bot })
      },
      (error: unknown) => {
        log.warn('apps identity backfill failed', { bot, error: error instanceof Error ? error.name : 'unknown' })
      }
    ).finally(() => { inFlight.delete(bot) })
    inFlight.set(bot, run)
  }

  return {
    onRoster(names) {
      const present = new Set(names)
      for (const bot of deps.store.bots()) {
        if (!present.has(bot) || inFlight.has(bot) || deps.store.record(bot)?.identity === true) continue
        const last = triedAt.get(bot)
        if (last !== undefined && deps.now() - last < retryMs) continue
        start(bot)
      }
    },
    async idle() {
      await Promise.all([...inFlight.values()])
    }
  }
}
