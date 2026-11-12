import { Hono } from 'hono'

import { PROFILE_NAME_RE } from '../bots/names.js'
import {
  RELAY_MAX_BYTES, RELAY_TEXT, canonicalMessage, RELAY_TIMEOUT_MS, UPSTREAM_MAX_BYTES,
  filterToolsList, judge, parseBearer, parseUpstream, rpcError
} from '../connectors/relay.js'
import { IDENTITY_HEADER } from '../connectors/hermes-mcp.js'
import type { KeyStore } from '../connectors/key.js'
import { type ConnectorStore, tokenMatches } from '../connectors/store.js'
import { log } from '../log.js'
import { readLimited } from './hook-routes.js'
import type { CrewEnv } from './session-guard.js'

export interface RelayDeps {
  readonly store: Pick<ConnectorStore, 'record'>
  readonly keys: Pick<KeyStore, 'get'>
  readonly fetch: typeof fetch
}

type Message = Record<string, unknown>

/**
 * `/mcp/:bot`: the only way a bot reaches Composio. Outside the session and CSRF guards; the per-bot
 * bearer token is the credential, and the `X-Crew-Bot` header (which Hermes resolves to the calling
 * profile's own name) must name the same bot: a profile cloned from another bot holds that bot's URL
 * and token but not its name. After both, every failure is a 200 JSON-RPC error (R4): a 401 would
 * make Hermes tell the user to run `hermes mcp login`.
 */
export function relayRoutes(deps: RelayDeps | undefined): Hono<CrewEnv> {
  const routes = new Hono<CrewEnv>()
  routes.on(['POST', 'GET', 'DELETE'], '/mcp/:bot', async c => {
    if (!deps) return c.json({ error: 'apps_unavailable' }, 503)
    const bot = c.req.param('bot')
    const record = PROFILE_NAME_RE.test(bot) ? deps.store.record(bot) : undefined
    // The body is never read here; closing keeps the unread rest from being parsed as the next request.
    const tokenOk = tokenMatches(record, parseBearer(c.req.header('authorization')))
    const identityOk = c.req.header(IDENTITY_HEADER) === bot
    if (!record || !tokenOk || !identityOk) {
      // One answer for every refusal. The claimed name is never logged: it is the caller's text.
      if (tokenOk && !identityOk) log.warn('mcp relay', { bot, outcome: 'identity_mismatch' })
      return c.json({ error: 'bad_token' }, 401, { Connection: 'close' })
    }
    const method = c.req.method
    if (method === 'GET') return c.body(null, 405, { Allow: 'POST, DELETE' })
    if (method === 'DELETE') return c.body(null, 204)

    const raw = await readLimited(c.req.raw, RELAY_MAX_BYTES)
    if (!raw) return c.json({ error: 'too_large' }, 413, { Connection: 'close' })
    let message: unknown
    try {
      message = JSON.parse(raw.toString('utf8'))
    } catch {
      return c.json(rpcError(null, -32700, 'Parse error'), 400)
    }
    const allowed = new Set(record.allowed)
    const verdict = judge(message, allowed)
    const msg = (message ?? {}) as Message
    const rpcMethod = typeof msg.method === 'string' ? msg.method.slice(0, 40) : undefined
    const tool = (msg.params as Message | undefined)?.name
    const fields = { bot, method: rpcMethod, ...(typeof tool === 'string' && allowed.has(tool) ? { tool } : {}) }
    const isNotification = typeof msg.method === 'string' && !('id' in msg)
    const fail = (code: number, text: string, outcome: string): Response => {
      log.info('mcp relay', { ...fields, outcome })
      return isNotification ? c.body(null, 202) : c.json(rpcError(msg.id, code, text), 200)
    }
    if (verdict.kind === 'refuse') return fail(verdict.code, verdict.message, 'refused')
    const key = deps.keys.get()
    if (!key) return fail(-32603, RELAY_TEXT.noKey, 'no_key')

    let upstream: Response
    try {
      upstream = await deps.fetch(record.mcpUrl, {
        method: 'POST',
        body: JSON.stringify(canonicalMessage(msg)),
        redirect: 'error',
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
        headers: {
          'x-api-key': key,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(c.req.header('mcp-protocol-version') ? { 'mcp-protocol-version': c.req.header('mcp-protocol-version') as string } : {})
        }
      })
    } catch {
      return fail(-32603, RELAY_TEXT.unreachable, 'unreachable')
    }
    if (upstream.status === 401 || upstream.status === 403) {
      await upstream.body?.cancel().catch(() => undefined)
      return fail(-32603, RELAY_TEXT.rejected, 'rejected')
    }
    if (!upstream.ok) {
      await upstream.body?.cancel().catch(() => undefined)
      return fail(-32603, RELAY_TEXT.unreachable, 'unreachable')
    }
    if (upstream.status === 202) {
      await upstream.body?.cancel().catch(() => undefined)
      return c.body(null, 202)
    }
    if (rpcMethod === 'tools/call') log.info('mcp relay', { ...fields, outcome: 'forwarded' })
    if (verdict.kind === 'filter') return filtered(c, upstream, msg.id, allowed, fail)
    const type = upstream.headers.get('content-type')
    return new Response(upstream.body, { status: 200, headers: type ? { 'content-type': type } : {} })
  })
  return routes
}

async function filtered(
  c: { json: (body: unknown, status: 200, headers: Record<string, string>) => Response },
  upstream: Response,
  id: unknown,
  allowed: ReadonlySet<string>,
  fail: (code: number, text: string, outcome: string) => Response
): Promise<Response> {
  let text: Buffer | null = null
  try {
    text = await readLimited(upstream, UPSTREAM_MAX_BYTES)
  } catch {
    text = null
  }
  const answer = text
    ? parseUpstream(upstream.headers.get('content-type') ?? '', text.toString('utf8'))
        .find(item => typeof item === 'object' && item !== null && (item as Message).id === id)
    : undefined
  if (answer === undefined || id === undefined) return fail(-32603, RELAY_TEXT.unreachable, 'unreachable')
  return c.json(filterToolsList(answer, allowed), 200, { 'content-type': 'application/json' })
}
