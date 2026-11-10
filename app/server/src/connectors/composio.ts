import { z } from 'zod'

import { log } from '../log.js'

export const COMPOSIO_API = 'https://backend.composio.dev/api/v3.1'
export const COMPOSIO_TIMEOUT_MS = 15_000
const MAX_TOOL_PAGES = 10

export type ComposioErrorCode = 'no_key' | 'key_rejected' | 'composio_unavailable' | 'not_found'

/** Carries a code only: no key, URL or upstream body can reach a message. */
export class ComposioError extends Error {
  constructor(readonly code: ComposioErrorCode) {
    super(`composio ${code}`)
    this.name = 'ComposioError'
  }
}

export interface ToolHint { readonly slug: string; readonly readOnly: boolean; readonly destructive: boolean }
export interface Toolkit { readonly slug: string; readonly name: string }
export type AccountStatus = 'connected' | 'pending' | 'failed'
export interface ConnectedAccount { readonly id: string; readonly toolkit: string; readonly status: AccountStatus }
export interface SessionSpec { readonly tools: Readonly<Record<string, readonly string[]>> }

export interface Composio {
  checkKey(key: string): Promise<void>
  searchToolkits(search: string): Promise<Toolkit[]>
  toolkit(slug: string): Promise<Toolkit>
  toolsOf(slug: string): Promise<ToolHint[]>
  managedAuthConfig(slug: string): Promise<string>
  link(authConfigId: string, userId: string): Promise<{ redirectUrl: string; accountId: string }>
  accounts(userId: string): Promise<ConnectedAccount[]>
  account(id: string): Promise<ConnectedAccount>
  deleteAccount(id: string): Promise<void>
  deleteSession(id: string): Promise<void>
  createSession(userId: string, spec: SessionSpec): Promise<{ sessionId: string; mcpUrl: string }>
}

const toolkitSchema = z.looseObject({ slug: z.string(), name: z.string() })
const toolkitsSchema = z.looseObject({ items: z.array(toolkitSchema) })
const toolsSchema = z.looseObject({ items: z.array(z.unknown()), next_cursor: z.string().nullish() })
const authConfigsSchema = z.looseObject({
  items: z.array(z.looseObject({ id: z.string(), is_composio_managed: z.boolean().optional(), status: z.string().optional() }))
})
const authConfigCreatedSchema = z.looseObject({ auth_config: z.looseObject({ id: z.string() }) })
const linkSchema = z.looseObject({ redirect_url: z.string(), connected_account_id: z.string() })
const accountSchema = z.looseObject({
  id: z.string(), status: z.string(), user_id: z.string().optional(), toolkit: z.looseObject({ slug: z.string() })
})
const accountsSchema = z.looseObject({ items: z.array(accountSchema) })
const sessionSchema = z.looseObject({ session_id: z.string(), mcp: z.looseObject({ url: z.string() }) })

const toolSchema = z.looseObject({ slug: z.string() })

const boolField = (obj: unknown, key: string): boolean | undefined => {
  const v = typeof obj === 'object' && obj !== null ? (obj as Record<string, unknown>)[key] : undefined
  return typeof v === 'boolean' ? v : undefined
}

/**
 * Ruling 5: Composio's REST returns `annotations: null` and carries hints as tags, so a boolean annotation wins,
 * else the tag. A tool with no boolean annotation and no `*Hint` tag counts as destructive. Bad fields are ignored.
 */
export function hintsOf(raw: unknown): ToolHint | null {
  const parsed = toolSchema.safeParse(raw)
  if (!parsed.success) return null
  const { slug } = parsed.data
  const o = raw as Record<string, unknown>
  const tags = Array.isArray(o.tags) ? o.tags.filter((t): t is string => typeof t === 'string') : []
  const has = (t: string) => tags.includes(t)
  const roAnn = boolField(o.annotations, 'readOnlyHint')
  const deAnn = boolField(o.annotations, 'destructiveHint')
  const readOnly = roAnn === true || has('readOnlyHint')
  const destructive = deAnn === true || has('destructiveHint')
  const hinted = roAnn !== undefined || deAnn !== undefined || tags.some(t => t.endsWith('Hint'))
  return { slug, readOnly, destructive: hinted ? destructive : true }
}

export function accountStatusOf(status: string): AccountStatus {
  if (status === 'ACTIVE') return 'connected'
  return status === 'INITIALIZING' || status === 'INITIATED' ? 'pending' : 'failed'
}

export function sessionBody(userId: string, spec: SessionSpec): Record<string, unknown> {
  const keys = Object.keys(spec.tools)
  return {
    user_id: userId,
    mcp: true,
    toolkits: { enable: keys },
    tools: Object.fromEntries(keys.map(k => [k, { enable: spec.tools[k] }])),
    workbench: { enable: false },
    search: { enable: false },
    manage_connections: { enable: false },
    execute: { enable_multi_execute: false },
    preload: { tools: keys.flatMap(k => spec.tools[k]) }
  }
}

function hostOk(url: string, ok: (host: string) => boolean): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.port === '' && ok(u.hostname)
  } catch {
    return false
  }
}

const MCP_HOST = 'backend.composio.dev'
const mcpUrlOk = (url: string) => hostOk(url, h => h === MCP_HOST)
const signInUrlOk = (url: string) => hostOk(url, h => h === 'composio.dev' || h.endsWith('.composio.dev'))

const enc = encodeURIComponent
const unavailable = () => new ComposioError('composio_unavailable')

export function createComposio(deps: { readonly fetch: typeof fetch; readonly key: () => string | null }): Composio {
  async function send<T>(
    call: string, key: string | null, method: string, path: string, schema: z.ZodType<T> | null, body?: unknown
  ): Promise<T> {
    if (key === null) throw new ComposioError('no_key')
    const headers: Record<string, string> = { 'x-api-key': key, accept: 'application/json' }
    if (body !== undefined) headers['content-type'] = 'application/json'
    let status: number | null = null
    try {
      const res = await deps.fetch(`${COMPOSIO_API}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(COMPOSIO_TIMEOUT_MS)
      })
      status = res.status
      if (status === 401 || status === 403) throw new ComposioError('key_rejected')
      if (status === 404) throw new ComposioError('not_found')
      if (!res.ok) throw unavailable()
      return schema === null ? (undefined as T) : schema.parse(await res.json())
    } catch (err) {
      if (err instanceof ComposioError) {
        if (err.code === 'composio_unavailable') log.warn('composio call failed', { call, status })
        throw err
      }
      // Network, timeout, redirect and shape errors: nothing from them is kept.
      log.warn('composio call failed', { call, status })
      throw unavailable()
    }
  }

  const get = <T>(call: string, path: string, schema: z.ZodType<T>) => send(call, deps.key(), 'GET', path, schema)
  const post = <T>(call: string, path: string, schema: z.ZodType<T>, body: unknown) =>
    send(call, deps.key(), 'POST', path, schema, body)
  const del = async (call: string, path: string): Promise<void> => {
    try {
      await send(call, deps.key(), 'DELETE', path, null)
    } catch (err) {
      if (!(err instanceof ComposioError && err.code === 'not_found')) throw err
    }
  }
  const toAccount = (a: z.infer<typeof accountSchema>): ConnectedAccount =>
    ({ id: a.id, toolkit: a.toolkit.slug, status: accountStatusOf(a.status) })

  return {
    checkKey: async key => {
      await send('checkKey', key, 'GET', '/toolkits?limit=1', toolkitsSchema)
    },
    searchToolkits: async search => {
      const q = search === '' ? '' : `&search=${enc(search)}`
      return (await get('searchToolkits', `/toolkits?limit=20${q}`, toolkitsSchema)).items.map(t => ({ slug: t.slug, name: t.name }))
    },
    toolkit: async slug => {
      const t = await get('toolkit', `/toolkits/${enc(slug)}`, toolkitSchema)
      return { slug: t.slug, name: t.name }
    },
    toolsOf: async slug => {
      const hints: ToolHint[] = []
      let cursor: string | null | undefined
      for (let page = 0; page < MAX_TOOL_PAGES; page++) {
        const c = cursor ? `&cursor=${enc(cursor)}` : ''
        const res = await get('toolsOf', `/tools?toolkit_slug=${enc(slug)}&limit=1000${c}`, toolsSchema)
        for (const raw of res.items) {
          const hint = hintsOf(raw)
          if (hint) hints.push(hint)
        }
        cursor = res.next_cursor
        if (!cursor) break
      }
      return hints
    },
    managedAuthConfig: async slug => {
      const found = await get('managedAuthConfig', `/auth_configs?toolkit_slug=${enc(slug)}`, authConfigsSchema)
      const ok = found.items.find(c => c.is_composio_managed === true && c.status === 'ENABLED')
      if (ok) return ok.id
      const made = await post('managedAuthConfig', '/auth_configs', authConfigCreatedSchema, {
        toolkit: { slug }, auth_config: { type: 'use_composio_managed_auth' }
      })
      return made.auth_config.id
    },
    link: async (authConfigId, userId) => {
      const res = await post('link', '/connected_accounts/link', linkSchema, { auth_config_id: authConfigId, user_id: userId })
      if (!signInUrlOk(res.redirect_url)) {
        log.warn('composio call failed', { call: 'link', status: null })
        throw unavailable()
      }
      return { redirectUrl: res.redirect_url, accountId: res.connected_account_id }
    },
    accounts: async userId => {
      const res = await get('accounts', `/connected_accounts?user_ids=${enc(userId)}&limit=100`, accountsSchema)
      return res.items.filter(a => a.user_id === userId).map(toAccount)
    },
    account: async id => toAccount(await get('account', `/connected_accounts/${enc(id)}`, accountSchema)),
    deleteAccount: id => del('deleteAccount', `/connected_accounts/${enc(id)}`),
    deleteSession: id => del('deleteSession', `/tool_router/session/${enc(id)}`),
    createSession: async (userId, spec) => {
      const res = await post('createSession', '/tool_router/session', sessionSchema, sessionBody(userId, spec))
      if (!mcpUrlOk(res.mcp.url)) {
        log.warn('composio call failed', { call: 'createSession', status: null })
        throw unavailable()
      }
      return { sessionId: res.session_id, mcpUrl: res.mcp.url }
    }
  }
}
