import type { Server } from 'node:http'
import { join } from 'node:path'

import { serve } from '@hono/node-server'

import { createApp } from './app.js'
import { ensureSecret } from './auth/secrets.js'
import { TicketStore } from './auth/tickets.js'
import { loadConfig } from './config.js'
import { connectGateway, createGatewayClient } from './hermes/gateway-client.js'
import { createHermesRest } from './hermes/rest-client.js'
import { HermesToken } from './hermes/token.js'
import { attachWsProxy } from './hermes/ws-proxy.js'
import { log } from './log.js'
import { createRoutineService } from './routines/service.js'
import { SettingsStore } from './settings/settings-store.js'
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
    now: Date.now,
    reconnectDelayMs: attempt => Math.min(30_000, 1000 * 2 ** attempt)
  })
  const rest = createHermesRest({ hermesUrl: config.hermesUrl, token })
  const app = createApp({ config, secrets, tickets: new TicketStore(), now: Date.now, token, fetchUpstream: fetch, watcher, settings, bots: { rpc: watcher.request, rest, refresh: watcher.refresh, now: Date.now }, routines: createRoutineService({ rest, now: Date.now }), usage: createUsageSource({ envFile: config.hermesEnvFile, fetch, now: Date.now }) })
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, info => {
    log.info('crew listening', { host: config.host, port: info.port })
  }) as Server
  attachWsProxy(server, { config, token, cookieKey: secrets.cookie, now: Date.now })
  return server
}

start().catch(error => {
  log.error('crew failed to start', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
