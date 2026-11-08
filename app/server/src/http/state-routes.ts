import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'

import { log } from '../log.js'
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
    const raw: unknown = await c.req.json().catch(() => null)
    const field = (name: string): unknown => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>)[name] : undefined)
    // Audit: one line per request that reaches this route. Approval choice only; text answers and
    // secrets are never logged, not even their length.
    const reply = (body: Record<string, unknown>, status: 202 | 400 | 404 | 409 | 422 | 503) => {
      const textual = entry !== undefined && entry.kind !== 'approval'
      const text = field(entry?.kind === 'clarify' ? 'answer' : 'value')
      log.info('answer received', {
        id, kind: entry?.kind ?? null, profile: entry?.profile ?? null,
        ...(entry?.kind === 'approval' && typeof field('choice') === 'string' ? { choice: (field('choice') as string).slice(0, 200) } : {}),
        hasText: textual && typeof text === 'string' && text.length > 0,
        status,
        ua: (c.req.header('user-agent') ?? '').slice(0, 200) || null,
        origin: c.req.header('origin') ?? null,
        fetchSite: c.req.header('sec-fetch-site') ?? null
      })
      return c.json(body, status)
    }
    if (!entry) return reply({ error: 'not_found' }, 404)
    if (entry.settled) return reply({ status: 'already_resolved' }, 409)
    if (entry.answerState === 'answering') return reply({ status: 'answering' }, 409)
    if (watcher.state().pending.find(p => p.id === id)?.answerable === false) return reply({ error: 'unsupported', hint: 'answer in the app that asked' }, 422)
    const body = bodies[entry.kind].safeParse(raw)
    if (!body.success) return reply({ error: 'bad_body' }, 400)
    if ('choice' in body.data && !entry.choices?.includes(body.data.choice)) return reply({ error: 'bad_choice' }, 400)
    const outcome = watcher.answer(id, body.data)
    if (outcome === 'offline') return reply({ error: 'hermes_offline' }, 503)
    return outcome === 'sent' ? reply({ status: 'sent' }, 202) : reply({ status: outcome }, 409)
  })
  return routes
}
