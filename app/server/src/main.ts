import type { Server } from 'node:http'

import { serve } from '@hono/node-server'

import { createApp } from './app.js'
import { loadConfig } from './config.js'
import { log } from './log.js'

/** Start the Crew server on loopback and return the Node server (WebSocket upgrades attach to it). */
export function start(): Server {
  const config = loadConfig(process.env)
  const app = createApp({ config })
  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, info => {
    log.info('crew listening', { host: config.host, port: info.port })
  })
  return server as Server
}

start()
