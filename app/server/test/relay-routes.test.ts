import { beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
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
  const app = createApp({ ...makeDeps(), relay: { store: { record: b => records[b] }, keys: { get: () => key }, fetch: fetchFake } })
  const send = (method: string, body?: BodyInit | null, headers: Record<string, string> = {}, bot = 'alpha') =>
    app.request(`/mcp/${bot}`, { method, body, duplex: 'half', headers: { Host: HOST, authorization: `Bearer ${TOKEN}`, ...headers } })
  return { calls, send, app }
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
