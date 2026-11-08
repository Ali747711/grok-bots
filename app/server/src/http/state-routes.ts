import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'

import type { Watcher } from '../watcher/watcher.js'
import type { CrewEnv } from './session-guard.js'

const HEARTBEAT_MS = 15_000
const TEXT_MAX = 4000
const AVATAR_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/
// SVG is deliberately absent: it can carry script.
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const DATA_URL = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]*)$/

const bodies = {
  approval: z.object({ choice: z.string() }),
  clarify: z.object({ answer: z.string().max(TEXT_MAX) }),
  secret: z.object({ value: z.string().max(TEXT_MAX) }),
  sudo: z.object({ value: z.string().max(TEXT_MAX) })
} as const

/** `GET /crew/state` (snapshot), `POST /crew/requests/:id/answer` (the only answer path) and `GET /crew/events` (SSE: event `state`, full CrewState on connect and on change). */
export function stateRoutes(watcher: Pick<Watcher, 'state' | 'onChange' | 'answer' | 'store' | 'getAvatar'> | undefined, heartbeatMs = HEARTBEAT_MS): Hono<CrewEnv> {
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
  routes.get('/crew/avatars/:name', async c => {
    const name = z.string().regex(AVATAR_NAME).safeParse(c.req.param('name'))
    if (!name.success) return c.json({ error: 'not_found' }, 404)
    if (!watcher || watcher.state().hermes !== 'connected') return c.json({ error: 'hermes_unavailable' }, 503)
    const asset = await watcher.getAvatar(name.data).catch(() => null)
    if (!asset) return c.json({ error: 'hermes_unavailable' }, 503)
    const match = asset.found && asset.data ? DATA_URL.exec(asset.data) : null
    const mime = match?.[1]?.toLowerCase()
    if (!match || !mime || !AVATAR_TYPES.has(mime)) return c.json({ error: 'not_found' }, 404)
    return c.body(Buffer.from(match[2] ?? '', 'base64'), 200, { 'Content-Type': mime, 'Cache-Control': 'private, max-age=300' })
  })
  routes.post('/crew/requests/:id/answer', async c => {
    if (!watcher) return c.json({ error: 'watcher_not_running' }, 503)
    const id = c.req.param('id')
    const entry = watcher.store.get(id)
    if (!entry) return c.json({ error: 'not_found' }, 404)
    if (entry.settled) return c.json({ status: 'already_resolved' }, 409)
    if (entry.answerState === 'answering') return c.json({ status: 'answering' }, 409)
    if (watcher.state().pending.find(p => p.id === id)?.answerable === false) return c.json({ error: 'unsupported', hint: 'answer in the app that asked' }, 422)
    const body = bodies[entry.kind].safeParse(await c.req.json().catch(() => null))
    if (!body.success) return c.json({ error: 'bad_body' }, 400)
    if ('choice' in body.data && !entry.choices?.includes(body.data.choice)) return c.json({ error: 'bad_choice' }, 400)
    const outcome = watcher.answer(id, body.data)
    if (outcome === 'offline') return c.json({ error: 'hermes_offline' }, 503)
    return outcome === 'sent' ? c.json({ status: 'sent' }, 202) : c.json({ status: outcome }, 409)
  })
  return routes
}
