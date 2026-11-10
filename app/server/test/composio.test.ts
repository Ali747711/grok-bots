import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  COMPOSIO_API, ComposioError, accountStatusOf, createComposio, hintsOf, sessionBody
} from '../src/connectors/composio.js'
import { setLogSink } from '../src/log.js'

const KEY = 'ak_test_key_123'

interface Call { url: string; init: RequestInit }
type Reply = { status?: number; body?: unknown; raw?: string } | Error

function harness(replies: Reply[], key: string | null = KEY) {
  const calls: Call[] = []
  const queue = [...replies]
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} })
    const r = queue.shift() ?? { status: 200, body: {} }
    if (r instanceof Error) throw r
    return new Response(r.raw ?? JSON.stringify(r.body ?? {}), { status: r.status ?? 200 })
  }) as typeof fetch
  return { calls, composio: createComposio({ fetch: fetchFn, key: () => key }) }
}

const code = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e instanceof ComposioError ? e.code : `other:${String(e)}`
  }
  return 'none'
}

let restoreLog: () => void
beforeEach(() => {
  restoreLog = setLogSink(() => {})
})
afterEach(() => restoreLog())

describe('composio client', () => {
  it('sends x-api-key, accept, a 15 s timeout and redirect error on every call', async () => {
    const { calls, composio } = harness([{ body: { items: [] } }])
    await composio.searchToolkits('')
    const { init } = calls[0]
    expect(init.headers).toMatchObject({ 'x-api-key': KEY, accept: 'application/json' })
    expect(init.redirect).toBe('error')
    expect(init.signal).toBeInstanceOf(AbortSignal)
    expect(calls[0].url).toBe(`${COMPOSIO_API}/toolkits?limit=20`)
  })

  it('throws no_key before any fetch when no key is saved', async () => {
    const { calls, composio } = harness([], null)
    expect(await code(composio.searchToolkits(''))).toBe('no_key')
    expect(await code(composio.accounts('u'))).toBe('no_key')
    expect(calls).toHaveLength(0)
  })

  it('maps 401 and 403 to key_rejected, 404 to not_found, and 500, a network error, a timeout and a bad shape to composio_unavailable', async () => {
    const replies: Reply[] = [
      { status: 401 }, { status: 403 }, { status: 404 }, { status: 500 },
      new Error('boom'), new DOMException('t', 'TimeoutError'), { body: { items: 'nope' } }
    ]
    const { composio } = harness(replies)
    const out = []
    for (let i = 0; i < replies.length; i++) out.push(await code(composio.searchToolkits('')))
    expect(out).toEqual(['key_rejected', 'key_rejected', 'not_found', 'composio_unavailable',
      'composio_unavailable', 'composio_unavailable', 'composio_unavailable'])
  })

  it('never puts the key, the upstream body or a URL in an error or a log line', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    const errors: string[] = []
    try {
      const { composio } = harness([
        { status: 500, raw: 'SECRET-BODY' }, new Error(`failed ${KEY} https://x.test`), { raw: 'SECRET-BODY' }
      ])
      for (let i = 0; i < 3; i++) {
        try { await composio.toolkit('github') } catch (e) { errors.push(`${(e as Error).message}${(e as Error).stack}`) }
      }
    } finally {
      restore()
    }
    const all = [...errors, ...lines].join('\n')
    for (const bad of [KEY, 'SECRET-BODY', 'https://', 'backend.composio.dev']) expect(all).not.toContain(bad)
    expect(lines.length).toBeGreaterThan(0)
    expect(JSON.parse(lines[0])).toMatchObject({ msg: 'composio call failed' })
  })

  it('builds the exact direct-tools session body', () => {
    expect(sessionBody('u-1', { tools: { github: ['GITHUB_GET_THE_AUTHENTICATED_USER'] } })).toEqual({
      user_id: 'u-1',
      mcp: true,
      toolkits: { enable: ['github'] },
      tools: { github: { enable: ['GITHUB_GET_THE_AUTHENTICATED_USER'] } },
      workbench: { enable: false },
      search: { enable: false },
      manage_connections: { enable: false },
      execute: { enable_multi_execute: false },
      preload: { tools: ['GITHUB_GET_THE_AUTHENTICATED_USER'] }
    })
  })

  it('creates a session and returns its id and MCP URL', async () => {
    const { calls, composio } = harness([{ status: 201, body: { session_id: 'trs_1', mcp: { type: 'http', url: 'https://backend.composio.dev/tool_router/trs_1/mcp' } } }])
    const spec = { tools: { github: ['A'] } }
    expect(await composio.createSession('u-1', spec)).toEqual({ sessionId: 'trs_1', mcpUrl: 'https://backend.composio.dev/tool_router/trs_1/mcp' })
    expect(calls[0].url).toBe(`${COMPOSIO_API}/tool_router/session`)
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(String(calls[0].init.body))).toEqual(sessionBody('u-1', spec))
  })

  it('refuses a session MCP URL outside https://backend.composio.dev and a sign-in URL outside composio.dev', async () => {
    const mcp = (url: string): Reply => ({ body: { session_id: 's', mcp: { url } } })
    const { composio } = harness([
      mcp('http://backend.composio.dev/x'), mcp('https://evil.dev/x'), mcp('https://backend.composio.dev.evil.dev/x'),
      { body: { redirect_url: 'http://composio.dev/a', connected_account_id: 'c' } },
      { body: { redirect_url: 'https://evil.dev/a', connected_account_id: 'c' } },
      { body: { redirect_url: 'https://composio.dev.evil.dev/a', connected_account_id: 'c' } },
      { body: { redirect_url: 'https://connect.composio.dev/link/x', connected_account_id: 'c1' } },
      { body: { redirect_url: 'https://composio.dev/link/x', connected_account_id: 'c2' } }
    ])
    for (let i = 0; i < 3; i++) expect(await code(composio.createSession('u', { tools: {} }))).toBe('composio_unavailable')
    for (let i = 0; i < 3; i++) expect(await code(composio.link('ac', 'u'))).toBe('composio_unavailable')
    expect(await composio.link('ac', 'u')).toEqual({ redirectUrl: 'https://connect.composio.dev/link/x', accountId: 'c1' })
    expect((await composio.link('ac', 'u')).accountId).toBe('c2')
  })

  it('reads hints from annotations, then tags, and counts a missing destructive hint as destructive', () => {
    expect(hintsOf({ slug: 'A', annotations: { readOnlyHint: true, destructiveHint: false } })).toEqual({ slug: 'A', readOnly: true, destructive: false })
    expect(hintsOf({ slug: 'B', annotations: { readOnlyHint: false, destructiveHint: true }, tags: ['readOnlyHint'] })).toEqual({ slug: 'B', readOnly: false, destructive: true })
    expect(hintsOf({ slug: 'C', tags: ['readOnlyHint', 'idempotent'] })).toEqual({ slug: 'C', readOnly: true, destructive: false })
    expect(hintsOf({ slug: 'D', tags: ['destructiveHint'] })).toEqual({ slug: 'D', readOnly: false, destructive: true })
    expect(hintsOf({ slug: 'E' })).toEqual({ slug: 'E', readOnly: false, destructive: true })
    expect(hintsOf({ slug: 'F', annotations: { readOnlyHint: true } })).toEqual({ slug: 'F', readOnly: true, destructive: false })
    expect(hintsOf({ name: 'x' })).toBeNull()
    expect(hintsOf(null)).toBeNull()
  })

  it("follows next_cursor for a toolkit's tools and stops after 10 pages", async () => {
    const one = harness([
      { body: { items: [{ slug: 'A', tags: ['readOnlyHint'] }, { nope: 1 }], next_cursor: 'c2' } },
      { body: { items: [{ slug: 'B' }], next_cursor: null } }
    ])
    expect((await one.composio.toolsOf('git hub')).map(t => t.slug)).toEqual(['A', 'B'])
    expect(one.calls[0].url).toBe(`${COMPOSIO_API}/tools?toolkit_slug=git%20hub&limit=1000`)
    expect(one.calls[1].url).toBe(`${COMPOSIO_API}/tools?toolkit_slug=git%20hub&limit=1000&cursor=c2`)

    const endless = harness(Array.from({ length: 20 }, (_, i) => ({ body: { items: [{ slug: `T${i}` }], next_cursor: `n${i}` } })))
    expect(await endless.composio.toolsOf('x')).toHaveLength(10)
    expect(endless.calls).toHaveLength(10)
  })

  it('finds an enabled Composio-managed auth config or creates one', async () => {
    const found = harness([{ body: { items: [
      { id: 'a1', is_composio_managed: false, status: 'ENABLED' },
      { id: 'a2', is_composio_managed: true, status: 'DISABLED' },
      { id: 'a3', is_composio_managed: true, status: 'ENABLED' }
    ] } }])
    expect(await found.composio.managedAuthConfig('github')).toBe('a3')
    expect(found.calls[0].url).toBe(`${COMPOSIO_API}/auth_configs?toolkit_slug=github`)

    const made = harness([{ body: { items: [] } }, { status: 201, body: { auth_config: { id: 'new1' } } }])
    expect(await made.composio.managedAuthConfig('github')).toBe('new1')
    expect(made.calls[1].init.method).toBe('POST')
    expect(JSON.parse(String(made.calls[1].init.body))).toEqual({ toolkit: { slug: 'github' }, auth_config: { type: 'use_composio_managed_auth' } })
  })

  it('lists only accounts of this user and maps their status', async () => {
    const { calls, composio } = harness([{ body: { items: [
      { id: 'c1', status: 'ACTIVE', user_id: 'u', toolkit: { slug: 'github' } },
      { id: 'c2', status: 'INITIATED', user_id: 'u', toolkit: { slug: 'gmail' } },
      { id: 'c3', status: 'EXPIRED', user_id: 'u', toolkit: { slug: 'slack' } },
      { id: 'c4', status: 'ACTIVE', user_id: 'other', toolkit: { slug: 'notion' } }
    ] } }])
    expect(await composio.accounts('u')).toEqual([
      { id: 'c1', toolkit: 'github', status: 'connected' },
      { id: 'c2', toolkit: 'gmail', status: 'pending' },
      { id: 'c3', toolkit: 'slack', status: 'failed' }
    ])
    expect(calls[0].url).toBe(`${COMPOSIO_API}/connected_accounts?user_ids=u&limit=100`)
    expect(accountStatusOf('INITIALIZING')).toBe('pending')
  })

  it('reads one account and one toolkit', async () => {
    const { calls, composio } = harness([
      { body: { id: 'c1', status: 'ACTIVE', toolkit: { slug: 'github' } } },
      { body: { slug: 'github', name: 'GitHub' } }
    ])
    expect(await composio.account('c/1')).toEqual({ id: 'c1', toolkit: 'github', status: 'connected' })
    expect(await composio.toolkit('github')).toEqual({ slug: 'github', name: 'GitHub' })
    expect(calls[0].url).toBe(`${COMPOSIO_API}/connected_accounts/c%2F1`)
  })

  it('treats 404 on account and session delete as done', async () => {
    const { calls, composio } = harness([{ status: 404 }, { status: 404 }, { status: 200 }, { status: 500 }])
    await composio.deleteAccount('c1')
    await composio.deleteSession('trs_1')
    await composio.deleteSession('trs_2')
    expect(await code(composio.deleteSession('trs_3'))).toBe('composio_unavailable')
    expect(calls[0].init.method).toBe('DELETE')
    expect(calls[1].url).toBe(`${COMPOSIO_API}/tool_router/session/trs_1`)
  })

  it('checks a candidate key with one read-only call', async () => {
    const { calls, composio } = harness([{ body: { items: [] } }], null)
    await composio.checkKey('ak_candidate_999')
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${COMPOSIO_API}/toolkits?limit=1`)
    expect(calls[0].init.headers).toMatchObject({ 'x-api-key': 'ak_candidate_999' })
    expect(calls[0].init.method ?? 'GET').toBe('GET')
  })
})
