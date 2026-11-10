import { withBotLock } from '../bots/bot-lock.js'
import { log } from '../log.js'
import { rebuildSession, setBotApps, type ConnectorDeps } from './bot-apps.js'
import { ComposioError, type AccountStatus } from './composio.js'
import { setAppsServerEnabled } from './hermes-mcp.js'
import type { KeyStore } from './key.js'
import type { AppLevel } from './levels.js'

/** R11: a sign-in nobody finished is abandoned after 10 minutes. */
export const SIGN_IN_TIMEOUT_MS = 600_000

export interface ConnectedApp { readonly id: string; readonly toolkit: string; readonly name: string; readonly status: AccountStatus }
export interface AppsList { readonly apps: readonly ConnectedApp[]; readonly usage: Readonly<Record<string, readonly string[]>> }
export type SignInState = 'pending' | 'connected' | 'failed' | 'expired'

export class AlreadyConnectedError extends Error {
  constructor() {
    super('already connected')
    this.name = 'AlreadyConnectedError'
  }
}

const errorName = (error: unknown): string => (error instanceof Error ? error.name : 'unknown')

export async function listApps(deps: ConnectorDeps): Promise<AppsList> {
  const accounts = await deps.composio.accounts(deps.store.userId())
  const usage: Record<string, string[]> = {}
  for (const bot of [...deps.store.bots()].sort()) {
    for (const toolkit of Object.keys(deps.store.record(bot)?.apps ?? {})) (usage[toolkit] ??= []).push(bot)
  }
  return {
    apps: accounts.map(a => ({ id: a.id, toolkit: a.toolkit, name: deps.store.name(a.toolkit) ?? a.toolkit, status: a.status })),
    usage
  }
}

export async function startConnect(
  deps: ConnectorDeps, toolkit: string
): Promise<{ readonly redirectUrl: string; readonly connectionId: string }> {
  const userId = deps.store.userId()
  // R12: one account per app.
  if ((await deps.composio.accounts(userId)).some(a => a.toolkit === toolkit && a.status === 'connected')) {
    throw new AlreadyConnectedError()
  }
  const { name } = await deps.composio.toolkit(toolkit)
  await deps.store.setName(toolkit, name)
  const authConfig = await deps.composio.managedAuthConfig(toolkit)
  const { redirectUrl, accountId } = await deps.composio.link(authConfig, userId)
  await deps.store.addPending({ id: accountId, toolkit, startedAt: deps.now() })
  return { redirectUrl, connectionId: accountId }
}

async function abandon(deps: ConnectorDeps, id: string): Promise<void> {
  try {
    await deps.composio.deleteAccount(id)
  } catch (error) {
    log.warn('sign-in account delete failed', { code: error instanceof ComposioError ? error.code : 'unknown' })
  }
  await deps.store.removePending(id)
}

/** Sessions are fixed at creation: after a sign-in each bot using the app gets a fresh one. Background, best effort. */
function rebuildForToolkit(deps: ConnectorDeps, toolkit: string): void {
  for (const bot of deps.store.bots()) {
    if (!(toolkit in (deps.store.record(bot)?.apps ?? {}))) continue
    void rebuildSession(deps, bot).catch(() => log.warn('rebuilding a bot after sign-in failed', { bot }))
  }
}

export async function pollConnect(deps: ConnectorDeps, id: string): Promise<SignInState> {
  const entry = deps.store.pending().find(p => p.id === id)
  const state = await settle(deps, id)
  if (state === 'connected' && entry) rebuildForToolkit(deps, entry.toolkit)
  return state
}

async function settle(deps: ConnectorDeps, id: string): Promise<SignInState> {
  const entry = deps.store.pending().find(p => p.id === id)
  if (!entry) throw new ComposioError('not_found')
  let status: AccountStatus
  try {
    status = (await deps.composio.account(id)).status
  } catch (error) {
    if (!(error instanceof ComposioError && error.code === 'not_found')) throw error
    status = 'failed'
  }
  if (status === 'connected') {
    await deps.store.removePending(id)
    return 'connected'
  }
  if (deps.now() - entry.startedAt > SIGN_IN_TIMEOUT_MS) {
    await abandon(deps, id)
    return 'expired'
  }
  if (status === 'failed') {
    await abandon(deps, id)
    return 'failed'
  }
  return 'pending'
}

/** The 60 s sweep: abandoned sign-ins (also ones loaded after a restart) lose their account. Never rejects. */
export async function expirePending(deps: ConnectorDeps): Promise<void> {
  if (deps.keys.get() === null) return
  for (const entry of [...deps.store.pending()]) {
    if (deps.now() - entry.startedAt <= SIGN_IN_TIMEOUT_MS) continue
    try {
      await settle(deps, entry.id)
    } catch (error) {
      log.warn('sign-in sweep failed', { error: errorName(error) })
    }
  }
}

export async function disconnect(deps: ConnectorDeps, id: string): Promise<void> {
  const account = (await deps.composio.accounts(deps.store.userId())).find(a => a.id === id)
  if (!account) throw new ComposioError('not_found')
  await deps.composio.deleteAccount(id)
  await deps.store.removePending(id)
  // Another connected account of the same app keeps it working for the bots.
  const left = await deps.composio.accounts(deps.store.userId())
  if (left.some(a => a.toolkit === account.toolkit && a.status === 'connected')) return
  for (const bot of deps.store.bots()) {
    const apps = deps.store.record(bot)?.apps
    if (!apps || !(account.toolkit in apps)) continue
    const { [account.toolkit]: _gone, ...rest } = apps
    try {
      await setBotApps(deps, bot, rest as Readonly<Record<string, AppLevel>>)
    } catch (error) {
      log.warn('removing a disconnected app failed', { bot, error: errorName(error) })
    }
  }
}

// keys.save shares one tmp name, so saves and removals run one at a time.
const queues = new WeakMap<KeyStore, Promise<unknown>>()
function serialized<T>(keys: KeyStore, task: () => Promise<T>): Promise<T> {
  const run = (queues.get(keys) ?? Promise.resolve()).then(task)
  queues.set(keys, run.catch(() => undefined))
  return run
}

export function saveKey(deps: ConnectorDeps, keys: KeyStore, key: string): Promise<void> {
  return serialized(keys, async () => {
    await deps.composio.checkKey(key)
    await keys.save(key)
    void resumeAll(deps)
  })
}

/** The file goes first so the reconnector's `wanted` check stops re-enabling; records stay (Q3). */
export function removeKey(deps: ConnectorDeps, keys: KeyStore): Promise<void> {
  return serialized(keys, async () => {
    await keys.remove()
    for (const bot of deps.store.bots()) {
      try {
        await withBotLock(bot, () => setAppsServerEnabled(deps.bots, bot, false))
      } catch (error) {
        log.warn('pausing a bot failed', { bot, error: errorName(error) })
      }
    }
  })
}

/** After a key is saved: fresh sessions, then each bot's server back on. A failed bot is logged. Never rejects. */
export async function resumeAll(deps: ConnectorDeps): Promise<void> {
  for (const bot of deps.store.bots()) {
    try {
      // A failed rebuild must not leave the bot paused: the relay fails closed on a dead session.
      await rebuildSession(deps, bot).catch((error: unknown) => {
        log.warn('resuming a bot failed', { bot, error: errorName(error) })
      })
      await withBotLock(bot, async () => {
        if (deps.keys.get() !== null && deps.store.record(bot)) await setAppsServerEnabled(deps.bots, bot, true)
      })
    } catch (error) {
      log.warn('resuming a bot failed', { bot, error: errorName(error) })
    }
  }
}
