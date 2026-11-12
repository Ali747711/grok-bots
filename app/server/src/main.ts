import { randomBytes, randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import { join } from 'node:path'

import { serve } from '@hono/node-server'

import { createApp } from './app.js'
import { ensureSecret } from './auth/secrets.js'
import { TicketStore } from './auth/tickets.js'
import { expirePending } from './connectors/account.js'
import { clampIfNoApprovals, forgetBot, type ConnectorDeps } from './connectors/bot-apps.js'
import { createComposio } from './connectors/composio.js'
import { createIdentityBackfill, type IdentityBackfill } from './connectors/identity.js'
import { KeyStore } from './connectors/key.js'
import { createReconnector } from './connectors/reconnect.js'
import { loadConnectorStore } from './connectors/store.js'
import { createOrphanSweep, type OrphanSweep } from './connectors/sweep.js'
import { loadConfig } from './config.js'
import { connectGateway, createGatewayClient } from './hermes/gateway-client.js'
import { createHermesRest } from './hermes/rest-client.js'
import { HermesToken } from './hermes/token.js'
import { attachWsProxy } from './hermes/ws-proxy.js'
import { readRawConfig } from './bots/sandbox.js'
import { createSandboxRoster } from './bots/sandbox-roster.js'
import { createGroupRpc } from './groups/group-rpc.js'
import { startGroupWatcher } from './groups/group-watcher.js'
import { log } from './log.js'
import { createDocker, createDockerRunner } from './sandbox/docker.js'
import { createImagePuller } from './sandbox/pull.js'
import { createRoutineService } from './routines/service.js'
import { SettingsStore } from './settings/settings-store.js'
import { composeCrewState } from './state/crew-state.js'
import { loadTriggerStore, wireTriggers } from './triggers/wire.js'
import { createUsageSource } from './usage/openrouter.js'
import { startWatcher } from './watcher/watcher.js'

/** Start the Crew server on loopback and return the Node server (WebSocket upgrades attach to it). */
export async function start(): Promise<Server> {
  const config = loadConfig(process.env)
  const secrets = {
    admin: await ensureSecret(join(config.stateDir, 'admin-secret')),
    cookie: await ensureSecret(join(config.stateDir, 'cookie-secret'))
  }
  const settings = await SettingsStore.load(join(config.stateDir, 'settings.json'))
  const token = new HermesToken(config.hermesTokenFile)
  const gateway = { config, token }
  const closeListeners = new Set<(code: number) => void>()
  const client = createGatewayClient(gateway, code => {
    for (const listener of closeListeners) listener(code)
  })
  const rest = createHermesRest({ hermesUrl: config.hermesUrl, token })
  let connectors: ConnectorDeps | undefined
  let sweep: OrphanSweep | undefined
  let identity: IdentityBackfill | undefined
  const roster = createSandboxRoster(name => readRawConfig({ rest }, name).then(raw => {
    // R9: this read repeats about once a minute, so a bot switched to approvals off is clamped soon after.
    if (connectors) clampIfNoApprovals(connectors, name, raw)
    return raw
  }), Date.now)
  const runner = createDockerRunner()
  const watcher = startWatcher({
    client,
    connect: async () => {
      try {
        await connectGateway(client, gateway)
      } catch (error) {
        // A rotated token surfaces as a failed connect: re-read it before the next backoff attempt.
        await token.refresh().catch(() => undefined)
        throw error
      }
    },
    onSocketClose: handler => {
      closeListeners.add(handler)
      return () => {
        closeListeners.delete(handler)
      }
    },
    settings,
    sandboxStates: roster.states,
    onRoster: names => {
      sweep?.onRoster(names)
      identity?.onRoster(names)
    },
    now: Date.now,
    reconnectDelayMs: attempt => Math.min(30_000, 1000 * 2 ** attempt)
  })
  const groupRpc = createGroupRpc(watcher.request)
  const connectionListeners = new Set<(connected: boolean) => void>()
  let wasConnected = watcher.state().hermes === 'connected'
  watcher.onChange(() => {
    const connected = watcher.state().hermes === 'connected'
    if (connected === wasConnected) return
    wasConnected = connected
    for (const listener of [...connectionListeners]) listener(connected)
  })
  const groupWatcher = startGroupWatcher({
    rpc: groupRpc,
    connected: () => watcher.state().hermes === 'connected',
    onConnectionChange: listener => {
      connectionListeners.add(listener)
      return () => connectionListeners.delete(listener)
    },
    now: Date.now
  })
  const crewState = composeCrewState(watcher, groupWatcher, groupRpc, Date.now)
  // Resume unfinished trigger runs before the server listens, so no hook can race it.
  const triggerStore = await loadTriggerStore(join(config.stateDir, 'triggers.json'))
  const hooks = triggerStore ? wireTriggers({ rest, store: triggerStore, now: Date.now, newId: randomUUID }).hooks : null
  const routines = createRoutineService({ rest, now: Date.now, ...(triggerStore ? { triggerRuns: (bot: string, id: string) => triggerStore.runsFor(bot, id) } : {}) })
  const triggers = triggerStore && hooks ? {
    store: triggerStore, hooks, routines,
    hookUrl: (id: string) => `http://${config.host}:${config.port}/hooks/${id}`,
    now: Date.now, newTriggerId: () => randomBytes(16).toString('hex'), newSecret: () => randomBytes(32).toString('hex'), newId: randomUUID
  } : undefined
  const sandbox = { docker: createDocker(runner), puller: createImagePuller(runner), hermesHome: config.hermesHome, groups: () => crewState.state().groups, onChanged: roster.invalidate }
  const base = { rpc: watcher.request, rest, refresh: watcher.refresh, now: Date.now, sandbox, apps: { forget: (bot: string) => (connectors ? forgetBot(connectors, bot) : Promise.resolve()), clamp: (bot: string, raw: unknown) => { if (connectors) clampIfNoApprovals(connectors, bot, raw) } } }
  const keys = await KeyStore.load(config.composioKeyFile)
  const connectorStore = await loadConnectorStore(join(config.stateDir, 'connectors.json'), randomUUID)
  if (connectorStore) {
    // Synchronous on purpose: the reconnector checks it under the bot lock (a paused bot stays paused).
    const wanted = (bot: string): boolean => connectorStore.record(bot) !== undefined && keys.get() !== null
    const reconnector = createReconnector({ hermes: base, wanted, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) })
    connectors = {
      bots: base, composio: createComposio({ fetch, key: () => keys.get() }), keys, store: connectorStore, reconnector,
      relayUrl: bot => `http://${config.host}:${config.port}/mcp/${bot}`, newToken: () => randomBytes(32).toString('base64url'), now: Date.now
    }
    const live = connectors
    sweep = createOrphanSweep({ bots: () => connectorStore.bots(), forget: bot => forgetBot(live, bot), now: Date.now })
    identity = createIdentityBackfill(live)
    setInterval(() => void expirePending(live), 60_000).unref()
  }
  const app = createApp({ config, secrets, tickets: new TicketStore(), now: Date.now, token, fetchUpstream: fetch, watcher: crewState, groups: { rpc: groupRpc, groups: groupWatcher, roster: () => crewState.state().bots.map(b => ({ name: b.name, title: b.title, displayName: b.displayName })), newId: randomUUID, sleep: ms => new Promise(resolve => setTimeout(resolve, ms)) }, settings, bots: base, ...(connectors ? { connectors: { connectors, keys }, relay: { store: connectorStore!, keys, fetch } } : {}), routines, triggers, usage: createUsageSource({ envFile: config.hermesEnvFile, fetch, now: Date.now }) })
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, info => {
    log.info('crew listening', { host: config.host, port: info.port })
  }) as Server
  // The primary bot is a bot too; the roster may not list it before the first sync.
  const knownBots = (): ReadonlySet<string> => new Set(['default', ...watcher.state().bots.map(bot => bot.name)])
  attachWsProxy(server, { config, token, cookieKey: secrets.cookie, now: Date.now, knownBots })
  return server
}

start().catch(error => {
  log.error('crew failed to start', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
