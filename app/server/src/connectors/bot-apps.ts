import { withBotLock } from '../bots/bot-lock.js'
import { readRawConfig } from '../bots/sandbox.js'
import { log } from '../log.js'
import {
  addAppsServer, appsServer, removeAppsServer, setAppsServerEnabled, type Hermes
} from './hermes-mcp.js'
import { ComposioError, HINTS_VERSION, type Composio, type ToolHint } from './composio.js'
import type { KeyStore } from './key.js'
import { TOOLKIT_RE, allowList, allowedSlugs, approvalsAsk, offeredLevels, type AppLevel } from './levels.js'
import { PRELOAD_CAP, ROOM_WRITES_DECLINED } from './policy.js'
import type { Reconnector } from './reconnect.js'
import { hashToken, type BotRecord, type ConnectorStore } from './store.js'

export interface ConnectorDeps {
  readonly bots: Hermes
  readonly composio: Composio
  readonly keys: Pick<KeyStore, 'get'>
  readonly store: ConnectorStore
  readonly reconnector: Reconnector
  readonly relayUrl: (bot: string) => string
  readonly newToken: () => string
  readonly now: () => number
}

export class AppsRefusedError extends Error {
  constructor(readonly code: 'no_key' | 'level_unavailable' | 'unknown_app') {
    super(`apps refused: ${code}`)
    this.name = 'AppsRefusedError'
  }
}

export interface AppEntry {
  readonly toolkit: string
  readonly name: string
  readonly level: AppLevel
  readonly tools: number
  readonly capped: boolean
}
export interface BotAppsView {
  readonly apps: readonly AppEntry[]
  readonly offered: readonly AppLevel[]
  readonly asks: boolean
  readonly keyConfigured: boolean
  readonly roomWritesDeclined: boolean
}

export const TOOLS_TTL_MS = 86_400_000

/** Tool hints for a toolkit: the cache while under 24 h old and made under the current hint rules, else Composio (which also refreshes the name). */
export async function toolsFor(deps: ConnectorDeps, toolkit: string): Promise<readonly ToolHint[]> {
  const cached = deps.store.toolkit(toolkit)
  if (cached && cached.hintsVersion === HINTS_VERSION && deps.now() - cached.fetchedAt < TOOLS_TTL_MS) return cached.tools
  const tools = await deps.composio.toolsOf(toolkit)
  const { name } = await deps.composio.toolkit(toolkit)
  await deps.store.setToolkit(toolkit, { fetchedAt: deps.now(), hintsVersion: HINTS_VERSION, tools })
  await deps.store.setName(toolkit, name)
  return tools
}

export async function readBotApps(deps: ConnectorDeps, bot: string): Promise<BotAppsView> {
  const raw = await readRawConfig(deps.bots, bot)
  const asks = approvalsAsk((raw.approvals as { mode?: unknown } | undefined)?.mode)
  const record = deps.store.record(bot)
  const apps = Object.entries(record?.apps ?? {}).sort(([a], [b]) => a.localeCompare(b)).map(([toolkit, level]) => ({
    toolkit, name: deps.store.name(toolkit) ?? toolkit, level,
    tools: record?.counts[toolkit]?.tools ?? 0, capped: record?.counts[toolkit]?.capped ?? false
  }))
  return {
    apps, offered: offeredLevels(asks), asks, keyConfigured: deps.keys.get() !== null,
    roomWritesDeclined: ROOM_WRITES_DECLINED
  }
}

const sameSet = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && [...a].sort().every((slug, i) => slug === [...b].sort()[i])

async function deleteSessionQuietly(deps: ConnectorDeps, bot: string, id: string): Promise<void> {
  if (deps.keys.get() === null) return
  try {
    await deps.composio.deleteSession(id)
  } catch (error) {
    // The relay only ever forwards to the record's session, so a leftover one is a cost, not a hole.
    log.warn('composio session delete failed', { bot, code: error instanceof ComposioError ? error.code : 'unknown' })
  }
}

interface Built { readonly sessionId: string; readonly mcpUrl: string; readonly allowed: readonly string[]; readonly counts: BotRecord['counts'] }

/** A new Composio session for these apps; each app's tools are the part of the allow list it owns. */
async function buildSession(deps: ConnectorDeps, bot: string, apps: Readonly<Record<string, AppLevel>>): Promise<Built> {
  const hints = new Map<string, readonly ToolHint[]>()
  for (const toolkit of Object.keys(apps).sort()) {
    try {
      hints.set(toolkit, await toolsFor(deps, toolkit))
    } catch (error) {
      if (error instanceof ComposioError && error.code === 'not_found') throw new AppsRefusedError('unknown_app')
      throw error
    }
  }
  const list = allowList(apps, t => hints.get(t) ?? [], PRELOAD_CAP)
  const keep = new Set(list.allowed)
  const tools = Object.fromEntries(Object.keys(apps).sort().map(t => [
    t, allowedSlugs(hints.get(t) ?? [], apps[t] as AppLevel).filter(slug => keep.has(slug))
  ]))
  const session = await deps.composio.createSession(deps.store.userId(), { tools })
  return { ...session, allowed: list.allowed, counts: list.byApp }
}

async function turnOff(deps: ConnectorDeps, bot: string): Promise<void> {
  await removeAppsServer(deps.bots, bot)
  const old = deps.store.record(bot)
  if (old) await deleteSessionQuietly(deps, bot, old.sessionId)
  await deps.store.deleteRecord(bot)
}

async function syncServer(
  deps: ConnectorDeps, bot: string, record: BotRecord, changed: boolean, minted: string | undefined
): Promise<void> {
  const server = await appsServer(deps.bots, bot)
  if (server !== null && minted !== undefined) {
    // The record is new but Hermes still holds the old token: replace the server so the hashes match.
    await removeAppsServer(deps.bots, bot)
    await addAppsServer(deps.bots, bot, deps.relayUrl(bot), minted)
    // The live transport keeps its old header until it rebuilds.
    deps.reconnector.schedule(bot)
  } else if (server === null) {
    // R7: a token exists only in this call, so a record whose server is gone gets a new one.
    const token = minted ?? deps.newToken()
    if (minted === undefined) await deps.store.setRecord(bot, { ...record, tokenHash: hashToken(token), identity: true })
    await addAppsServer(deps.bots, bot, deps.relayUrl(bot), token)
  } else if (!server.enabled) {
    await setAppsServerEnabled(deps.bots, bot, true)
  } else if (changed) {
    deps.reconnector.schedule(bot)
  }
}

export function setBotApps(deps: ConnectorDeps, bot: string, apps: Readonly<Record<string, AppLevel>>): Promise<BotAppsView> {
  // A bad slug must never reach the store: one would make the next load treat the whole file as corrupt.
  if (Object.keys(apps).some(t => !TOOLKIT_RE.test(t))) return Promise.reject(new AppsRefusedError('unknown_app'))
  return withBotLock(bot, async () => {
    if (Object.keys(apps).length === 0) {
      await turnOff(deps, bot)
      return readBotApps(deps, bot)
    }
    if (deps.keys.get() === null) throw new AppsRefusedError('no_key')
    const raw = await readRawConfig(deps.bots, bot)
    const offered = offeredLevels(approvalsAsk((raw.approvals as { mode?: unknown } | undefined)?.mode))
    if (Object.values(apps).some(level => !offered.includes(level))) throw new AppsRefusedError('level_unavailable')
    const old = deps.store.record(bot)
    const built = await buildSession(deps, bot, apps)
    const minted = old ? undefined : deps.newToken()
    const record: BotRecord = {
      apps, counts: built.counts, sessionId: built.sessionId, mcpUrl: built.mcpUrl, allowed: built.allowed,
      tokenHash: old?.tokenHash ?? hashToken(minted as string),
      // A new record's server is always (re)written by syncServer, with the identity header.
      ...(old === undefined || old.identity === true ? { identity: true } : {})
    }
    await saveOrDrop(deps, bot, record)
    if (old) await deleteSessionQuietly(deps, bot, old.sessionId)
    await syncServer(deps, bot, record, !sameSet(old?.allowed ?? [], record.allowed), minted)
    return readBotApps(deps, bot)
  })
}

async function saveOrDrop(deps: ConnectorDeps, bot: string, record: BotRecord): Promise<void> {
  try {
    await deps.store.setRecord(bot, record)
  } catch (error) {
    await deleteSessionQuietly(deps, bot, record.sessionId)
    throw error
  }
}

/** A fresh session from the bot's current apps (key re-saved, or tools changed); the token is untouched. */
export function rebuildSession(deps: ConnectorDeps, bot: string): Promise<void> {
  return withBotLock(bot, async () => {
    const old = deps.store.record(bot)
    if (!old) return
    if (deps.keys.get() === null) throw new AppsRefusedError('no_key')
    const built = await buildSession(deps, bot, old.apps)
    await saveOrDrop(deps, bot, { ...old, ...built })
    await deleteSessionQuietly(deps, bot, old.sessionId)
    if (!sameSet(old.allowed, built.allowed)) deps.reconnector.schedule(bot)
  })
}

/** The bot is gone: drop its session (best effort, needs the key) and record. Never rejects. */
export function forgetBot(deps: ConnectorDeps, bot: string): Promise<void> {
  return withBotLock(bot, async () => {
    try {
      const old = deps.store.record(bot)
      if (old) await deleteSessionQuietly(deps, bot, old.sessionId)
      await deps.store.deleteRecord(bot)
    } catch (error) {
      log.warn('forgetting a bot failed', { bot, error: error instanceof Error ? error.name : 'unknown' })
    }
  })
}

const clamping = new Set<string>()

/**
 * R9: a bot whose approvals are off can only read. Given the bot's raw config, drops every app above
 * Read to Read in the background (one in flight per bot); `setBotApps` re-checks under the lock.
 */
export function clampIfNoApprovals(deps: ConnectorDeps, bot: string, raw: unknown): void {
  const mode = ((raw as { approvals?: { mode?: unknown } } | null | undefined)?.approvals)?.mode
  if (approvalsAsk(mode) || clamping.has(bot)) return
  const apps = deps.store.record(bot)?.apps
  if (!apps || Object.values(apps).every(level => level === 'read')) return
  clamping.add(bot)
  const reads = Object.fromEntries(Object.keys(apps).map(toolkit => [toolkit, 'read' as AppLevel]))
  void setBotApps(deps, bot, reads).then(
    () => { log.info('apps clamped to read: approvals are off', { bot }) },
    error => { log.warn('apps clamp failed', { bot, error: error instanceof Error ? error.name : 'unknown' }) }
  ).finally(() => { clamping.delete(bot) })
}
