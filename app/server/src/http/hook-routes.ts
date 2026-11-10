import { Hono } from 'hono'
import { log } from '../log.js'

import { type HookHandler, MAX_HOOK_BYTES } from '../triggers/hook-handler.js'
import { TRIGGER_ID_RE } from '../triggers/types.js'
import type { CrewEnv } from './session-guard.js'

/**
 * The raw request bytes (the signature is over exactly these), or null when over `max`. A declared
 * length above the cap answers at once; otherwise the stream is cancelled the moment the count passes it.
 */
export async function readLimited(req: Pick<Request, 'headers' | 'body'>, max: number): Promise<Buffer | null> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > max) return null
  if (!req.body) return Buffer.alloc(0)
  const reader = req.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}

/** `POST /hooks/:id`: outside the session and CSRF guards (the host guard still applies). */
export function hookRoutes(handler: HookHandler | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.post('/hooks/:id', async c => {
    if (!handler) return c.json({ error: 'triggers_unavailable' }, 503)
    const id = c.req.param('id')
    try {
      if (!handler.known(id)) {
        // An unknown id costs nothing: no body is read. Close the connection so the unread body is not parsed as a request.
        const result = await handler.handle(id, Buffer.alloc(0), c.req.raw.headers)
        return c.json(result.body, result.status, { Connection: 'close' })
      }
      const raw = await readLimited(c.req.raw, MAX_HOOK_BYTES)
      const result = await handler.handle(id, raw, c.req.raw.headers)
      // After a refused oversized body the unread rest must not be parsed as the next request.
      return c.json(result.body, result.status, result.status === 413 ? { Connection: 'close' } : {})
    } catch (error) {
      // A throw (runner, store) or a client abort mid-read: still one logged outcome, never the message (it could carry text from the request).
      log.info('hook event', { ...(TRIGGER_ID_RE.test(id) ? { trigger: id.slice(0, 8) } : {}), status: 500, outcome: 'error', kind: error instanceof Error ? error.name : 'unknown' })
      return c.json({ error: 'internal' }, 500)
    }
  })
  return routes
}
