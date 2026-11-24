import { withBotLock } from '../bots/bot-lock.js'
import { log } from '../log.js'
import type { ConnectorDeps } from './bot-apps.js'
import { addAppsServer, appsServer, removeAppsServer } from './hermes-mcp.js'
import { hashToken, unmarked } from './store.js'

/** A bot whose backfill failed is tried again on a later roster sync, at most this often. */
export const IDENTITY_RETRY_MS = 30_000

/**
 * `none`: the bot has no apps (or was already marked and only unmarked ones were asked for).
 * `done`: new token, new entry, and the live connection was rebuilt. `unconfirmed`: the entry was
 * replaced but the rebuild did not go through; the record stays unmarked so the backfill runs it again.
 */
export type Rotation = 'none' | 'done' | 'unconfirmed'

export interface IdentityBackfill {
  onRoster(names: readonly string[]): void
  /** Resolves when every backfill started so far has settled (tests). */
  idle(): Promise<void>
}

interface Replaced { readonly enabled: boolean; readonly tokenHash: string }

/** Under the bot's lock: the old token dies first, then the entry is removed and written again. */
async function replaceEntry(deps: ConnectorDeps, bot: string, onlyUnmarked: boolean): Promise<Replaced | null> {
  const record = deps.store.record(bot)
  if (!record || (onlyUnmarked && record.identity === true)) return null
  const server = await appsServer(deps.bots, bot)
  // A paused bot (no key) stays paused.
  const enabled = server ? server.enabled : deps.keys.get() !== null
  const token = deps.newToken()
  const tokenHash = hashToken(token)
  await deps.store.setRecord(bot, { ...unmarked(record), tokenHash })
  if (server) await removeAppsServer(deps.bots, bot)
  await addAppsServer(deps.bots, bot, deps.relayUrl(bot), token, enabled)
  return { enabled, tokenHash }
}

/**
 * Replaces a bot's relay token and `crew_apps` entry (a token exists only in the call that minted it,
 * R7), rebuilds its live connection and only then marks the record. Apps, levels and the Composio
 * session are untouched. Used by the backfill, and whenever a copy of the token may exist elsewhere
 * (a clone whose apps strip failed): the relay's identity header does not stop a token holder.
 * The reconnect takes the bot's lock itself, so it runs between the two locked steps.
 */
export async function rotateToken(deps: ConnectorDeps, bot: string, onlyUnmarked = false): Promise<Rotation> {
  const replaced = await withBotLock(bot, () => replaceEntry(deps, bot, onlyUnmarked))
  if (!replaced) return 'none'
  if (replaced.enabled) {
    // The live transport keeps its old token and headers until it rebuilds.
    deps.reconnector.schedule(bot)
    if (!(await deps.reconnector.settled(bot))) return 'unconfirmed'
  }
  return withBotLock(bot, async () => {
    const current = deps.store.record(bot)
    // Turned off or rotated again meanwhile: that change owns the record now.
    if (!current || current.tokenHash !== replaced.tokenHash) return 'unconfirmed'
    await deps.store.setRecord(bot, { ...current, identity: true })
    return 'done'
  })
}

/**
 * The bot's entry was removed outside `setBotApps` (Finish setup strips every bot): drop the mark so the
 * backfill writes a new entry on the next roster sync. The caller holds the bot's lock.
 */
export async function unmarkRecord(deps: Pick<ConnectorDeps, 'store'>, bot: string): Promise<void> {
  const record = deps.store.record(bot)
  if (record?.identity === true) await deps.store.setRecord(bot, unmarked(record))
}

/** The backfill for one bot whose entry predates the identity header. Does nothing for a marked record. */
export function ensureIdentity(deps: ConnectorDeps, bot: string): Promise<Rotation> {
  return rotateToken(deps, bot, true)
}

/**
 * The migration for bots that had apps before the identity header, and the repair for any record left
 * unmarked by a failed write or reconnect: on each roster sync (the first one comes right after Crew
 * connects to Hermes) every listed bot with an unmarked record is upgraded.
 */
export function createIdentityBackfill(deps: ConnectorDeps, retryMs: number = IDENTITY_RETRY_MS): IdentityBackfill {
  const inFlight = new Map<string, Promise<void>>()
  const triedAt = new Map<string, number>()

  const start = (bot: string): void => {
    triedAt.set(bot, deps.now())
    const run = ensureIdentity(deps, bot).then(
      outcome => {
        if (outcome === 'unconfirmed') return log.warn('apps identity backfill failed', { bot, error: 'reconnect' })
        triedAt.delete(bot)
        if (outcome === 'done') log.info('apps identity added', { bot })
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
