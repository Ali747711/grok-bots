import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { signSession } from '../src/auth/session-cookie.js'
import { loadConfig } from '../src/config.js'
import { HermesToken } from '../src/hermes/token.js'
import { attachWsProxy } from '../src/hermes/ws-proxy.js'

const cookieKey = Buffer.alloc(32, 7)
const now = () => 1_000_000
const valid = `crew_session=${signSession(cookieKey, { sid: 's', exp: now() + 60_000 })}`

let upstream: WebSocketServer
let upstreamSockets: WebSocket[]
let upstreamUrls: string[]
let crew: Server
let port: number
let token: HermesToken

beforeEach(async () => {
  upstreamSockets = []
  upstreamUrls = []
  upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => upstream.on('listening', () => resolve()))
  upstream.on('connection', (ws, req) => {
    upstreamSockets.push(ws)
    upstreamUrls.push(req.url ?? '')
  })
  const upPort = (upstream.address() as AddressInfo).port

  crew = createServer((_req, res) => res.writeHead(404).end())
  await new Promise<void>(resolve => crew.listen(0, '127.0.0.1', resolve))
  port = (crew.address() as AddressInfo).port
  token = new HermesToken('/unused')
  vi.spyOn(token, 'get').mockResolvedValue('tok-1')
  vi.spyOn(token, 'refresh').mockResolvedValue('tok-2')
  const config = loadConfig({ HOME: '/home/ali', CREW_PORT: String(port), CREW_HERMES_URL: `http://127.0.0.1:${upPort}` })
  attachWsProxy(crew, { config, token, cookieKey, now })
})

afterEach(async () => {
  for (const ws of upstreamSockets) ws.terminate()
  await new Promise<void>(resolve => upstream.close(() => resolve()))
  crew.closeAllConnections()
  await new Promise<void>(resolve => crew.close(() => resolve()))
})

function connect(opts: { origin?: string; cookie?: string; path?: string }): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${opts.path ?? '/api/ws'}`, {
      ...(opts.origin ? { origin: opts.origin } : {}),
      headers: opts.cookie ? { Cookie: opts.cookie } : {}
    })
    ws.once('open', () => resolve(ws))
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    ws.once('error', reject)
  })
}

const origin = () => `http://127.0.0.1:${port}`
const nextMessage = (ws: WebSocket) =>
  new Promise<{ data: Buffer; isBinary: boolean }>(resolve =>
    ws.once('message', (data, isBinary) => resolve({ data: data as Buffer, isBinary })))
const closeCode = (ws: WebSocket) => new Promise<number>(resolve => ws.once('close', code => resolve(code)))
const waitForUpstream = async () => {
  for (let i = 0; i < 50 && upstreamSockets.length === 0; i++) await new Promise(r => setTimeout(r, 10))
  const ws = upstreamSockets[0]
  if (!ws) throw new Error('no upstream connection')
  return ws
}

describe('WebSocket proxy', () => {
  it('rejects foreign Origin with 403 before touching upstream', async () => {
    await expect(connect({ origin: 'http://evil.example', cookie: valid })).rejects.toThrow(/403/)
    expect(upstreamSockets.length).toBe(0)
  })

  it('rejects a missing session cookie with 403', async () => {
    await expect(connect({ origin: origin() })).rejects.toThrow(/403/)
  })

  it('rejects a missing Origin with 403', async () => {
    await expect(connect({ cookie: valid })).rejects.toThrow(/403/)
  })

  it('refuses upgrades on other paths', async () => {
    await expect(connect({ origin: origin(), cookie: valid, path: '/api/pty' })).rejects.toThrow(/404/)
  })

  it('relays text and binary frames both ways and puts the token in the upstream query', async () => {
    const ws = await connect({ origin: origin(), cookie: valid })
    ws.send('{"jsonrpc":"2.0","id":1,"method":"ping"}')
    const up = await waitForUpstream()
    const received = await nextMessage(up)
    expect(received.data.toString()).toBe('{"jsonrpc":"2.0","id":1,"method":"ping"}')
    expect(received.isBinary).toBe(false)
    expect(upstreamUrls[0]).toBe('/api/ws?token=tok-1')
    const pending = nextMessage(ws)
    up.send(Buffer.from([1, 2, 3]), { binary: true })
    const back = await pending
    expect(back.isBinary).toBe(true)
    expect(Buffer.from(back.data)).toEqual(Buffer.from([1, 2, 3]))
    ws.close()
  })

  it('passes upstream close code 4000 to the client', async () => {
    const ws = await connect({ origin: origin(), cookie: valid })
    const up = await waitForUpstream()
    const closed = closeCode(ws)
    up.close(4000, 'control-taken')
    expect(await closed).toBe(4000)
  })

  it('upstream drop closes client with 1012', async () => {
    const ws = await connect({ origin: origin(), cookie: valid })
    const up = await waitForUpstream()
    const closed = closeCode(ws)
    up.terminate()
    expect(await closed).toBe(1012)
  })

  it('upstream 4401 → client 4401 + token refresh', async () => {
    const ws = await connect({ origin: origin(), cookie: valid })
    const up = await waitForUpstream()
    const closed = closeCode(ws)
    up.close(4401, 'bad credential')
    expect(await closed).toBe(4401)
    expect(token.refresh).toHaveBeenCalledTimes(1)
  })

  it('closing the client closes the upstream', async () => {
    const ws = await connect({ origin: origin(), cookie: valid })
    const up = await waitForUpstream()
    const closed = closeCode(up)
    ws.close(1000)
    expect(await closed).toBe(1000)
  })
})
