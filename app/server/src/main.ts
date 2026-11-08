import type { Server } from 'node:http'
import { join } from 'node:path'

import { serve } from '@hono/node-server'

import { createApp } from './app.js'
import { ensureSecret } from './auth/secrets.js'
import { TicketStore } from './auth/tickets.js'
import { loadConfig } from './config.js'
import { log } from './log.js'

/** Start the Crew server on loopback and return the Node server (WebSocket upgrades attach to it). */
export async function start(): Promise<Server> {
  const config = loadConfig(process.env)
  const secrets = {
    admin: await ensureSecret(join(config.stateDir, 'admin-secret')),
    cookie: await ensureSecret(join(config.stateDir, 'cookie-secret'))
  }
  const app = createApp({ config, secrets, tickets: new TicketStore(), now: Date.now })
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, info => {
    log.info('crew listening', { host: config.host, port: info.port })
  })
  return server as Server
}

start().catch(error => {
  log.error('crew failed to start', { error: error instanceof Error ? error.message : String(error) })
  process.exit(1)
})
