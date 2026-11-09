import { Hono } from 'hono'

import { type HookHandler, MAX_HOOK_BYTES } from '../triggers/hook-handler.js'
import type { CrewEnv } from './session-guard.js'

/**
 * The raw request bytes (the signature is over exactly these), or null when over `max`. A declared
 * length above the cap answers at once; otherwise the stream is cancelled the moment the count passes it.
 */
export async function readLimited(req: Request, max: number): Promise<Buffer | null> {
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
    const raw = await readLimited(c.req.raw, MAX_HOOK_BYTES)
    const result = await handler.handle(c.req.param('id'), raw, c.req.raw.headers)
    return c.json(result.body, result.status)
  })
  return routes
}
