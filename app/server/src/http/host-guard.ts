import type { MiddlewareHandler } from 'hono'

/**
 * Reject requests whose Host header is not exactly one of Crew's loopback names.
 * This blocks DNS-rebinding: a hostile site resolving its own name to 127.0.0.1 still sends its own Host.
 */
export function hostGuard(allowed: readonly string[]): MiddlewareHandler {
  const allowedSet = new Set(allowed)
  return async (c, next) => {
    const host = c.req.header('host')
    if (host === undefined || !allowedSet.has(host)) {
      return c.json({ error: 'bad_host' }, 400)
    }
    await next()
  }
}
