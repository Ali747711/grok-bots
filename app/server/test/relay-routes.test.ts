import { beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { MISMATCH_LOG_MS } from '../src/http/relay-routes.js'
import { RELAY_TEXT } from '../src/connectors/relay.js'
import { hashToken, type BotRecord } from '../src/connectors/store.js'
import { setLogSink } from '../src/log.js'
import { HOST, makeDeps } from './helpers.js'

const TOKEN = 'T'.repeat(43)
const OTHER = 'O'.repeat(43)
const KEY = 'ak_test_key_123'
const URL_ = 'https://backend.composio.dev/tool_router/session-1/mcp'
const rec = (token: string): BotRecord => ({ apps: {}, counts: {}, sessionId: 's', mcpUrl: URL_, allowed: ['GITHUB_GET_REPO'], tokenHash: hashToken(token) })

interface Call { url: string; init: RequestInit }
function setup(upstream: () => Response | Promise<Response> = () => new Response('{}'), key: string | null = KEY) {
  const calls: Call[] = []
  const fetchFake = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return upstream() }) as unknown as typeof fetch
  const records: Record<string, BotRecord> = { alpha: rec(TOKEN), beta: rec(OTHER) }
  const clock = { now: 0 }
  const app = createApp({ ...makeDeps(), relay: { store: { record: b => records[b] }, keys: { get: () => key }, fetch: fetchFake, now: () => clock.now } })
  const send = (method: string, body?: BodyInit | null, headers: Record<string, string> = {}, bot = 'alpha') =>
    app.request(`/mcp/${bot}`, { method, body, duplex: 'half', headers: { Host: HOST, authorization: `Bearer ${TOKEN}`, 'x-crew-bot': bot, ...headers } })
  return { calls, send, app, clock }
}
function captureLogs(): string[] {
  const lines: string[] = []
  setLogSink(line => { lines.push(typeof line === 'string' ? line : JSON.stringify(line)) })
  return lines
}
const rpc = (m: object) => JSON.stringify({ jsonrpc: '2.0', ...m })
const call = (name: string) => rpc({ id: 1, method: 'tools/call', params: { name } })

describe('relay routes', () => {
  beforeAll(() => { setLogSink(() => undefined) })

  it("answers 401 bad_token for a missing, wrong or other bot's token, for every method, before reading the body", async () => {
    const { send, calls } = setup()
    for (const method of ['POST', 'GET', 'DELETE']) {
      for (const authorization of [undefined, `Bearer ${OTHER}`, 'Bearer nope', `Basic ${TOKEN}`]) {
        const res = await send(method, method === 'POST' ? call('GITHUB_GET_REPO') : null, authorization ? { authorization } : { authorization: '' })
        expect(res.status).toBe(401)
        expect(await res.json()).toEqual({ error: 'bad_token' })
      }
    }
    expect((await send('POST', '{}', {}, 'ghost')).status).toBe(401)
    expect((await send('POST', '{}', {}, 'Bad Name')).status).toBe(401)
    // a stream that would throw if read proves the body is untouched
    const body = new ReadableStream({ pull() { throw new Error('body was read') } })
    const res = await send('POST', body, { authorization: `Bearer ${OTHER}`, 'content-type': 'application/json' }, 'alpha')
    expect(res.status).toBe(401)
    expect(calls).toHaveLength(0)
  })

  it('answers 401 bad_token when X-Crew-Bot is missing or names another bot, even with the right token, before reading the body', async () => {
    const { send, calls } = setup()
    const logs = captureLogs()
    for (const method of ['POST', 'GET', 'DELETE']) {
      for (const identity of ['', 'beta', 'ALPHA', 'alpha, beta', 'default']) {
        const res = await send(method, method === 'POST' ? call('GITHUB_GET_REPO') : null, { 'x-crew-bot': identity })
        expect(res.status, `${method} ${identity}`).toBe(401)
        expect(await res.json()).toEqual({ error: 'bad_token' })
      }
    }
    const body = new ReadableStream({ pull() { throw new Error('body was read') } })
    expect((await send('POST', body, { 'x-crew-bot': 'beta', 'content-type': 'application/json' })).status).toBe(401)
    expect(calls).toHaveLength(0)
    expect(logs.some(l => l.includes('identity_mismatch'))).toBe(true)
    expect(logs.join('\n')).not.toContain(TOKEN)
    setLogSink(() => undefined)
  })

  it('answers 401 when the X-Crew-Bot header is absent altogether, with a valid token', async () => {
    const { app, calls } = setup()
    for (const method of ['POST', 'GET', 'DELETE']) {
      const res = await app.request('/mcp/alpha', {
        method, headers: { Host: HOST, authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: call('GITHUB_GET_REPO') } : {})
      })
      expect(res.status, method).toBe(401)
      expect(await res.json()).toEqual({ error: 'bad_token' })
    }
    expect(calls).toHaveLength(0)
  })

  it('logs an identity mismatch at most once a minute per bot, and never for a wrong token', async () => {
    const { send, clock } = setup()
    const logs = captureLogs()
    const mismatches = (): number => logs.filter(l => l.includes('identity_mismatch')).length
    for (let i = 0; i < 5; i += 1) await send('POST', '{}', { 'x-crew-bot': 'clone1' })
    expect(mismatches()).toBe(1)
    await send('POST', '{}', { authorization: `Bearer ${OTHER}`, 'x-crew-bot': 'clone1' }, 'beta')
    expect(mismatches()).toBe(2)
    await send('POST', '{}', { authorization: 'Bearer nope', 'x-crew-bot': 'clone1' })
    clock.now = MISMATCH_LOG_MS - 1
    await send('POST', '{}', { 'x-crew-bot': 'clone1' })
    expect(mismatches()).toBe(2)
    clock.now = MISMATCH_LOG_MS
    await send('POST', '{}', { 'x-crew-bot': 'clone1' })
    expect(mismatches()).toBe(3)
    expect(logs.join('\n')).not.toContain('clone1')
    setLogSink(() => undefined)
  })

  it("refuses a cloned config: the primary's URL and token with the clone's identity, and the clone's identity with another bot's token", async () => {
    const { send, calls } = setup()
    // a clone of alpha: alpha's path and token, but Hermes resolves the header to the clone's own name
    const cloned = await send('POST', call('GITHUB_GET_REPO'), { 'x-crew-bot': 'clone1' }, 'alpha')
    expect(cloned.status).toBe(401)
    expect(await cloned.json()).toEqual({ error: 'bad_token' })
    // beta's token and identity do not open alpha's path, and alpha's token does not open beta's
    expect((await send('POST', call('GITHUB_GET_REPO'), { authorization: `Bearer ${OTHER}`, 'x-crew-bot': 'beta' }, 'alpha')).status).toBe(401)
    expect((await send('POST', call('GITHUB_GET_REPO'), { 'x-crew-bot': 'beta' }, 'beta')).status).toBe(401)
    expect(calls).toHaveLength(0)
    // each bot with its own token and identity still works
    expect((await send('POST', call('GITHUB_GET_REPO'))).status).toBe(200)
    expect((await send('POST', call('GITHUB_GET_REPO'), { authorization: `Bearer ${OTHER}` }, 'beta')).status).toBe(200)
    expect(calls).toHaveLength(2)
  })

  it('answers 405 to GET and 204 to DELETE only after the token check', async () => {
    const { send } = setup()
    const get = await send('GET')
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST, DELETE')
    expect((await send('DELETE')).status).toBe(204)
  })

  it('answers 413 for a body over 1 MiB without forwarding it', async () => {
    const { send, calls } = setup()
    const big = 'x'.repeat(1_048_577)
    const declared = await send('POST', big, { 'content-length': String(big.length) })
    expect(declared.status).toBe(413)
    expect(declared.headers.get('connection')).toBe('close')
    const stream = new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(new Uint8Array(600_000)); c.enqueue(new Uint8Array(600_000)); c.close() }
    })
    expect((await send('POST', stream)).status).toBe(413)
    expect(calls).toHaveLength(0)
  })

  it('answers 400 parse error for a body that is not JSON', async () => {
    const { send } = setup()
    const res = await send('POST', 'nope')
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ id: null, error: { code: -32700, message: 'Parse error' } })
  })

  it('never forwards a disallowed tools/call', async () => {
    const { send, calls } = setup()
    for (const body of [call('GITHUB_DELETE_REPO'), '[]', rpc({ id: 1, method: 'Tools/Call', params: { name: 'GITHUB_GET_REPO' } }), rpc({ id: 1, method: 'resources/read' })]) {
      expect((await send('POST', body)).status).toBe(200)
    }
    const res = await send('POST', call('GITHUB_DELETE_REPO'))
    expect(await res.json()).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: RELAY_TEXT.notAllowed } })
    expect(calls).toHaveLength(0)
  })

  it('forwards with the key header to the session URL and sends no cookie or token upstream', async () => {
    const { send, calls } = setup(() => new Response('{"jsonrpc":"2.0","id":1,"result":{}}', { headers: { 'content-type': 'application/json', 'set-cookie': 'a=b', 'x-extra': '1' } }))
    const res = await send('POST', call('GITHUB_GET_REPO'), { cookie: 'crew_session=s', origin: 'http://x', 'mcp-protocol-version': '2025-06-18' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('x-extra')).toBeNull()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(URL_)
    const init = calls[0]?.init as RequestInit
    expect(init.redirect).toBe('error')
    expect(init.headers).toEqual({
      'x-api-key': KEY, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18'
    })
    expect(JSON.stringify(init.headers)).not.toContain(TOKEN)
    await send('POST', rpc({ id: 2, method: 'ping' }))
    expect(Object.keys(calls[1]?.init.headers as object)).not.toContain('mcp-protocol-version')
  })

  it('forwards only the canonical message and refuses ambiguous keys', async () => {
    const del = { name: 'GITHUB_DELETE_REPO' }
    const bodies = [
      '{"method":"tools/call","params":{"name":"GITHUB_DELETE_REPO"},"method":"ping"}',
      '{"id":1,"method":"tools/call","params":{"name":"GITHUB_GET_REPO"},"params":{"name":"GITHUB_DELETE_REPO"}}',
      '{"id":1,"method":"tools/call","params":{"name":"GITHUB_DELETE_REPO","name":"GITHUB_GET_REPO"}}',
      '{"id":1,"method":"ping","Method":"tools/call","params":{"name":"GITHUB_DELETE_REPO"}}',
      JSON.stringify({ id: 1, method: 'tools/call', params: { name: 'GITHUB_GET_REPO', Name: del.name } }),
      '{"id":1,"PARAMS":{},"method":"ping"}'
    ]
    for (const body of bodies) {
      const { send, calls } = setup()
      expect((await send('POST', body)).status).toBe(200)
      for (const c of calls) {
        const sent = JSON.parse(c.init.body as string)
        // a ping may still carry a stray params object; what matters is the single method that is forwarded
        if (sent.method === 'tools/call') expect(sent.params.name).toBe('GITHUB_GET_REPO')
        expect(Object.keys(sent).every(k => ['jsonrpc', 'id', 'method', 'params'].includes(k))).toBe(true)
        expect(c.init.body).toBe(JSON.stringify(sent))
      }
    }
    const refused = setup()
    expect(await (await refused.send('POST', bodies[3] as string)).json()).toMatchObject({ error: { code: -32600, message: 'Invalid request' } })
    expect(refused.calls).toHaveLength(0)
    const { send, calls } = setup()
    await send('POST', '{ "extra": 1, "params": {"name": "GITHUB_GET_REPO"}, "method": "tools/call", "id": 1, "jsonrpc": "2.0" }')
    expect(calls[0]?.init.body).toBe('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"GITHUB_GET_REPO"}}')
  })

  it('returns a filtered tools/list from an SSE upstream as JSON', async () => {
    const list = { jsonrpc: '2.0', id: 7, result: { tools: [{ name: 'GITHUB_GET_REPO' }, { name: 'GITHUB_DELETE_REPO' }] } }
    const { send } = setup(() => new Response(`event: message\ndata: {"jsonrpc":"2.0","method":"notifications/x"}\n\nevent: message\ndata: ${JSON.stringify(list)}\n\n`, { headers: { 'content-type': 'text/event-stream' } }))
    const res = await send('POST', rpc({ id: 7, method: 'tools/list' }))
    expect(res.headers.get('content-type')).toContain('application/json')
    expect(await res.json()).toEqual({ ...list, result: { tools: [{ name: 'GITHUB_GET_REPO' }] } })
    const none = setup(() => new Response('event: message\ndata: {"id":99}\n\n', { headers: { 'content-type': 'text/event-stream' } }))
    expect(await (await none.send('POST', rpc({ id: 7, method: 'tools/list' }))).json()).toMatchObject({ error: { message: RELAY_TEXT.unreachable } })
  })

  it('streams a tools/call SSE answer through with its content type', async () => {
    const sse = 'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{"content":[]}}\n\n'
    const { send } = setup(() => new Response(sse, { headers: { 'content-type': 'text/event-stream' } }))
    const res = await send('POST', call('GITHUB_GET_REPO'))
    expect(res.headers.get('content-type')).toBe('text/event-stream')
    expect(await res.text()).toBe(sse)
  })

  it('maps no key, an upstream 401, a 500 and a network failure to fixed JSON-RPC errors', async () => {
    const leak = 'UPSTREAM-SECRET-TEXT'
    const cases: [string, ReturnType<typeof setup>][] = [
      [RELAY_TEXT.noKey, setup(undefined, null)],
      [RELAY_TEXT.rejected, setup(() => new Response(leak, { status: 401 }))],
      [RELAY_TEXT.rejected, setup(() => new Response(leak, { status: 403 }))],
      [RELAY_TEXT.unreachable, setup(() => new Response(leak, { status: 500 }))],
      [RELAY_TEXT.unreachable, setup(() => { throw new Error(`${leak} ${KEY}`) })]
    ]
    for (const [text, s] of cases) {
      const res = await s.send('POST', call('GITHUB_GET_REPO'))
      expect(res.status).toBe(200)
      const raw = await res.text()
      expect(JSON.parse(raw)).toEqual({ jsonrpc: '2.0', id: 1, error: { code: -32603, message: text } })
      expect(raw).not.toContain(leak)
    }
    expect(cases[0]?.[1].calls).toHaveLength(0)
    const note = await cases[3]?.[1].send('POST', rpc({ method: 'notifications/initialized' }))
    expect(note?.status).toBe(202)
    expect(await note?.text()).toBe('')
    const accepted = await setup(() => new Response(null, { status: 202 })).send('POST', rpc({ method: 'notifications/initialized' }))
    expect(accepted.status).toBe(202)
  })

  it('answers 503 apps_unavailable without relay deps', async () => {
    const res = await createApp(makeDeps()).request('/mcp/alpha', { method: 'POST', headers: { Host: HOST } })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'apps_unavailable' })
  })

  it('never logs the token, the key or the body', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    try {
      const secret = 'BODY-SECRET-ARG'
      const { send } = setup(() => { throw new Error(KEY) })
      await send('POST', rpc({ id: 1, method: 'tools/call', params: { name: 'GITHUB_GET_REPO', arguments: { q: secret } } }))
      await send('POST', rpc({ id: 1, method: 'tools/call', params: { name: secret } }))
      await send('POST', rpc({ id: 1, method: 'resources/read' }))
      await send('POST', 'nope', { authorization: `Bearer ${OTHER}` })
      const all = lines.join('\n')
      expect(lines.length).toBeGreaterThan(0)
      for (const s of [TOKEN, OTHER, KEY, secret]) expect(all).not.toContain(s)
    } finally { restore() }
  })
})
