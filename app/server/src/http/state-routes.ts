import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'

import type { Watcher } from '../watcher/watcher.js'
import type { CrewEnv } from './session-guard.js'

const HEARTBEAT_MS = 15_000
const TEXT_MAX = 4000

const bodies = {
  approval: z.object({ choice: z.string() }),
  clarify: z.object({ answer: z.string().max(TEXT_MAX) }),
  secret: z.object({ value: z.string().max(TEXT_MAX) }),
  sudo: z.object({ value: z.string().max(TEXT_MAX) })
} as const

/** `GET /crew/state` (snapshot), `POST /crew/requests/:id/answer` (the only answer path) and `GET /crew/events` (SSE: event `state`, full CrewState on connect and on change). */
export function stateRoutes(watcher: Pick<Watcher, 'state' | 'onChange' | 'answer' | 'store'> | undefined, heartbeatMs = HEARTBEAT_MS): Hono<CrewEnv> {
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
  routes.post('/crew/requests/:id/answer', async c => {
    if (!watcher) return c.json({ error: 'watcher_not_running' }, 503)
    const id = c.req.param('id')
    const entry = watcher.store.get(id)
    if (!entry) return c.json({ error: 'not_found' }, 404)
    if (entry.settled) return c.json({ status: 'already_resolved' }, 409)
    if (entry.answerState === 'answering') return c.json({ status: 'answering' }, 409)
    const body = bodies[entry.kind].safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'bad_body' }, 400)
    if ('choice' in body.data && !entry.choices?.includes(body.data.choice)) return c.json({ error: 'bad_choice' }, 400)
    const outcome = watcher.answer(id, body.data)
    return outcome === 'sent' ? c.json({ status: 'sent' }, 202) : c.json({ status: outcome }, 409)
  })
  return routes
}
