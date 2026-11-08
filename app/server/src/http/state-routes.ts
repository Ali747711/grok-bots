import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'

import type { Watcher } from '../watcher/watcher.js'
import type { CrewEnv } from './session-guard.js'

const HEARTBEAT_MS = 15_000

/** `GET /crew/state` (snapshot) and `GET /crew/events` (SSE: event `state`, full CrewState on connect and on change). */
export function stateRoutes(watcher: Pick<Watcher, 'state' | 'onChange'> | undefined, heartbeatMs = HEARTBEAT_MS): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.get('/crew/state', c => (watcher ? c.json(watcher.state()) : c.json({ error: 'watcher_not_running' }, 503)))
  routes.get('/crew/events', c => {
    if (!watcher) return c.json({ error: 'watcher_not_running' }, 503)
    return streamSSE(c, async stream => {
      const send = () => stream.writeSSE({ event: 'state', data: JSON.stringify(watcher.state()) }).catch(() => undefined)
      const off = watcher.onChange(() => void send())
      const heartbeat = setInterval(() => void stream.write(': keep-alive\n\n').catch(() => undefined), heartbeatMs)
      const closed = new Promise<void>(resolve => stream.onAbort(resolve))
      try {
        await send()
        await closed
      } finally {
        clearInterval(heartbeat)
        off()
      }
    })
  })
  return routes
}
