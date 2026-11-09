import type { Context } from 'hono'
import { Hono } from 'hono'

import type { CrewConfig } from '../config.js'
import type { CrewEnv } from '../http/session-guard.js'
import { log } from '../log.js'
import type { HermesToken } from './token.js'

/** The only Hermes REST areas the browser may reach through Crew (prefix match on path segments). */
export const PROXY_ALLOWLIST = [
  '/api/profiles',
  '/api/sessions',
  '/api/cron',
  '/api/skills',
  '/api/analytics',
  '/api/model',
  '/api/chat/file-upload',
  '/api/chat/image-upload',
  '/api/status'
] as const

const DROP_REQUEST_HEADERS = new Set([
  'host', 'cookie', 'origin', 'referer', 'connection', 'content-length', 'authorization',
  'x-hermes-session-token', 'x-crew-csrf', 'x-crew-admin', 'keep-alive', 'transfer-encoding', 'upgrade'
])
const KEEP_RESPONSE_HEADERS = ['content-type', 'content-length', 'content-disposition', 'cache-control', 'etag', 'last-modified']

export interface RestProxyDeps {
  readonly config: CrewConfig
  readonly token: HermesToken
  readonly fetchUpstream: typeof fetch
}

export function isProxied(path: string): boolean {
  return PROXY_ALLOWLIST.some(prefix => path === prefix || path.startsWith(prefix + '/'))
}

function upstreamHeaders(source: Headers, token: string): Headers {
  const headers = new Headers()
  source.forEach((value, name) => {
    if (!DROP_REQUEST_HEADERS.has(name) && !name.startsWith('x-crew-')) headers.set(name, value)
  })
  headers.set('x-hermes-session-token', token)
  return headers
}

function downstream(res: Response): Response {
  const headers = new Headers()
  for (const name of KEEP_RESPONSE_HEADERS) {
    const value = res.headers.get(name)
    if (value !== null) headers.set(name, value)
  }
  return new Response(res.body, { status: res.status, headers })
}

async function send(deps: RestProxyDeps, c: Context<CrewEnv>, token: string, withBody: boolean): Promise<Response> {
  const url = new URL(c.req.url)
  const init: RequestInit & { duplex?: 'half' } = {
    method: c.req.method,
    headers: upstreamHeaders(c.req.raw.headers, token),
    redirect: 'manual',
    ...(withBody ? { body: c.req.raw.body, duplex: 'half' } : {})
  }
  return deps.fetchUpstream(`${deps.config.hermesUrl}${url.pathname}${url.search}`, init)
}

async function forward(deps: RestProxyDeps, c: Context<CrewEnv>): Promise<Response> {
  const withBody = c.req.raw.body !== null && !['GET', 'HEAD'].includes(c.req.method)
  const first = await send(deps, c, await deps.token.get(), withBody)
  if (first.status !== 401) {
    deps.token.markOk()
    return downstream(first)
  }
  await first.body?.cancel()
  const fresh = await deps.token.refresh()
  if (withBody) {
    // A streamed body cannot be replayed; the client retries with the refreshed token.
    log.warn('hermes rejected token on a bodied request; refreshed', { path: c.req.path })
    return c.json({ error: 'hermes_token_refreshed' }, 503)
  }
  const second = await send(deps, c, fresh, false)
  if (second.status === 401) {
    await second.body?.cancel()
    deps.token.markSignedOut()
    log.warn('hermes rejected refreshed token; signed out', { path: c.req.path })
    return c.json({ error: 'hermes_signed_out' }, 503)
  }
  deps.token.markOk()
  return downstream(second)
}

/** `ALL /api/*` → Hermes, with the token added server-side and browser credentials removed. */
export function restProxy(deps: RestProxyDeps): Hono<CrewEnv> {
  const proxy = new Hono<CrewEnv>()
  proxy.all('/api/*', async c => {
    if (!isProxied(c.req.path)) return c.json({ error: 'not_proxied' }, 404)
    try {
      return await forward(deps, c)
    } catch (error) {
      log.warn('hermes request failed', { path: c.req.path, error: error instanceof Error ? error.name : 'unknown' })
      return c.json({ error: 'hermes_unreachable' }, 502)
    }
  })
  return proxy
}
