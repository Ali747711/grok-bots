import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { serveStatic } from '@hono/node-server/serve-static'
import { type Context, Hono, type MiddlewareHandler } from 'hono'

import type { CrewEnv } from './session-guard.js'

export const SPA_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"

const NOT_BUILT_HTML =
  '<!doctype html><meta charset="utf-8"><title>Crew</title><p>Crew web app not built yet.</p>'

function isApiPath(path: string): boolean {
  return /^\/(api|crew)(\/|$)/.test(path)
}

function secure(c: Context): void {
  c.header('Content-Security-Policy', SPA_CSP)
  c.header('X-Content-Type-Options', 'nosniff')
}

/**
 * Serve the built web app from `webDist`: real files first, `index.html` for any other path
 * (client-side routes). `/api` and `/crew` are never answered here. Mount this last.
 */
export function spaRoutes(webDist: string): Hono<CrewEnv> {
  const indexPath = join(webDist, 'index.html')
  // serveStatic logs when its root is missing, so only build it once the app exists.
  let files: MiddlewareHandler | undefined
  const staticFiles = (): MiddlewareHandler => (files ??= serveStatic({ root: webDist }))

  const routes = new Hono<CrewEnv>()
  routes.get('*', async (c, next) => {
    if (isApiPath(c.req.path)) return next()
    if (!existsSync(indexPath)) return c.html(NOT_BUILT_HTML, 200, { 'X-Content-Type-Options': 'nosniff' })
    secure(c)
    let fellThrough = false
    const served = await staticFiles()(c, async () => {
      fellThrough = true
    })
    if (!fellThrough && served) return served
    return c.html(readFileSync(indexPath, 'utf8'))
  })
  return routes
}
