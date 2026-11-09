import { EventEmitter } from 'node:events'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Duplex } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WebSocket, WebSocketServer } from 'ws'

import { signSession } from '../src/auth/session-cookie.js'
import { loadConfig } from '../src/config.js'
import { attachDisplayBridge, relay, type Pausable } from '../src/hermes/display-proxy.js'
import { HermesToken } from '../src/hermes/token.js'
import { attachWsProxy } from '../src/hermes/ws-proxy.js'
import { setLogSink } from '../src/log.js'

const cookieKey = Buffer.alloc(32, 7)
const now = () => 1_000_000
const valid = `crew_session=${signSession(cookieKey, { sid: 's', exp: now() + 60_000 })}`
const TICKET = 'tkt-SECRET-123'

let upstream: WebSocketServer
let upstreamSockets: WebSocket[]
let upstreamReqs: { url: string; headers: IncomingHttpHeaders }[]
let upstreamEvents: string[]
let crew: Server
let port: number
let upPort: number
let logLines: string[]
let restoreLog: () => void

function startCrew(hermesUrl: string): void {
  const config = loadConfig({ HOME: '/home/ali', CREW_PORT: String(port), CREW_HERMES_URL: hermesUrl })
  const token = new HermesToken('/unused')
  vi.spyOn(token, 'get').mockResolvedValue('tok-SECRET')
  attachWsProxy(crew, { config, token, cookieKey, now, knownBots: () => new Set() })
}

beforeEach(async () => {
  upstreamSockets = []
  upstreamReqs = []
  upstreamEvents = []
  logLines = []
  restoreLog = setLogSink(line => logLines.push(line))
  upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  await new Promise<void>(resolve => upstream.on('listening', () => resolve()))
  upstream.on('connection', (ws, req) => {
    upstreamSockets.push(ws)
    upstreamReqs.push({ url: req.url ?? '', headers: req.headers })
    ws.on('close', code => upstreamEvents.push(`close:${code}`))
    ws.on('error', () => undefined)
  })
  upPort = (upstream.address() as AddressInfo).port
  crew = createServer((_req, res) => res.writeHead(404).end())
  await new Promise<void>(resolve => crew.listen(0, '127.0.0.1', resolve))
  port = (crew.address() as AddressInfo).port
  startCrew(`http://127.0.0.1:${upPort}`)
})

afterEach(async () => {
  restoreLog()
  for (const ws of upstreamSockets) ws.terminate()
  await new Promise<void>(resolve => upstream.close(() => resolve()))
  crew.closeAllConnections()
  await new Promise<void>(resolve => crew.close(() => resolve()))
})

const origin = () => `http://127.0.0.1:${port}`
function connect(opts: { origin?: string | null; cookie?: string | null; query?: string } = {}): Promise<WebSocket> {
  const query = opts.query ?? `?display_ticket=${TICKET}`
  const cookie = opts.cookie === undefined ? valid : opts.cookie
  const org = opts.origin === undefined ? origin() : opts.origin
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/display/ws${query}`, {
      ...(org ? { origin: org } : {}),
      headers: { ...(cookie ? { Cookie: cookie } : {}), 'X-Crew-Token': 'abc' }
    })
    ws.once('open', () => resolve(ws))
    ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)))
    ws.once('error', reject)
  })
}
const closeInfo = (ws: WebSocket) => new Promise<{ code: number; reason: string }>(resolve => ws.once('close', (code, reason) => resolve({ code, reason: reason.toString() })))
const until = async (check: () => boolean) => {
  for (let i = 0; i < 100 && !check(); i++) await new Promise(r => setTimeout(r, 10))
  if (!check()) throw new Error('condition not met')
}

describe('display proxy', () => {
  it('refuses the upgrade without our Host, exact Origin and session', async () => {
    await expect(connect({ origin: 'http://evil.example' })).rejects.toThrow(/403/)
    await expect(connect({ cookie: null })).rejects.toThrow(/403/)
    await expect(connect({ origin: null })).rejects.toThrow(/403/)
    expect(upstreamSockets).toHaveLength(0)
  })

  it('forwards only display_ticket and sends no Origin, cookie or token upstream', async () => {
    const ws = await connect({ query: `?display_ticket=${TICKET}&token=leak&profile=other` })
    await until(() => upstreamReqs.length === 1)
    const req = upstreamReqs[0]!
    expect(req.url).toBe(`/api/display/ws?display_ticket=${TICKET}`)
    expect(req.headers.origin).toBeUndefined()
    expect(req.headers.cookie).toBeUndefined()
    expect(req.headers['x-crew-token']).toBeUndefined()
    expect(JSON.stringify(req.headers)).not.toContain('tok-SECRET')
    ws.close(1000)
  })

  it('answers 4401 without dialing when the ticket is missing', async () => {
    const ws = await connect({ query: '' })
    expect((await closeInfo(ws)).code).toBe(4401)
    expect(upstreamSockets).toHaveLength(0)
  })

  it('relays binary frames both ways', async () => {
    const ws = await connect()
    await until(() => upstreamSockets.length === 1)
    const got = new Promise<Buffer>(resolve => upstreamSockets[0]!.once('message', d => resolve(d as Buffer)))
    ws.send(Buffer.from([4, 1, 2]), { binary: true })
    expect([...(await got)]).toEqual([4, 1, 2])
    const back = new Promise<Buffer>(resolve => ws.once('message', d => resolve(d as Buffer)))
    upstreamSockets[0]!.send(Buffer.from([9, 8]), { binary: true })
    expect([...(await back)]).toEqual([9, 8])
    ws.close(1000)
  })

  it('turns an abnormal browser close into an upstream terminate, keeping the lease', async () => {
    const ws = await connect()
    await until(() => upstreamSockets.length === 1)
    ws.terminate()
    await until(() => upstreamEvents.length === 1)
    // terminate sends no close frame, so Hermes sees 1006 (lease kept), never a clean 1000.
    expect(upstreamEvents[0]).toBe('close:1006')
  })

  it('treats a browser close with no code (1005) or 4999 as an abnormal upstream close', async () => {
    for (const code of [undefined, 4999]) {
      upstreamEvents.length = 0
      const before = upstreamSockets.length
      const ws = await connect()
      await until(() => upstreamSockets.length === before + 1)
      if (code === undefined) ws.close()
      else ws.close(code)
      await until(() => upstreamEvents.length === 1)
      expect(upstreamEvents[0]).toBe('close:1006')
    }
  })

  it('turns a browser 1000 or 1001 into an upstream close 1000', async () => {
    for (const code of [1000, 1001]) {
      upstreamEvents.length = 0
      const before = upstreamSockets.length
      const ws = await connect()
      await until(() => upstreamSockets.length === before + 1)
      ws.close(code)
      await until(() => upstreamEvents.length === 1)
      expect(upstreamEvents[0]).toBe('close:1000')
    }
  })

  it('forwards Hermes close codes and reasons to the browser', async () => {
    const cases: [number, string, number][] = [[4000, 'control-taken', 4000], [4001, 'Bot Desktop is not running', 4001], [4401, 'display ticket missing, expired or used', 4401], [1000, '', 1000], [1003, 'RFB is binary', 1003]]
    for (const [code, reason, expected] of cases) {
      const before = upstreamSockets.length
      const ws = await connect()
      await until(() => upstreamSockets.length === before + 1)
      const closed = closeInfo(ws)
      upstreamSockets[before]!.close(code, reason)
      expect(await closed).toEqual({ code: expected, reason })
    }
    const ws = await connect()
    await until(() => upstreamSockets.length === cases.length + 1)
    const closed = closeInfo(ws)
    upstreamSockets.at(-1)!.close(4000, 'x'.repeat(123))
    expect((await closed).reason).toHaveLength(123)
  })

  it('forwards a long non-ASCII reason without throwing', async () => {
    const ws = await connect()
    await until(() => upstreamSockets.length === 1)
    const closed = closeInfo(ws)
    upstreamSockets[0]!.close(4000, '界'.repeat(41)) // 123 bytes, the most a close frame may carry
    const { code, reason } = await closed
    expect(code).toBe(4000)
    expect(Buffer.byteLength(reason)).toBeLessThanOrEqual(123)
  })

  it('answers 4403 for an upstream 403 and 1013 for a failed dial', async () => {
    const refuser = createServer()
    refuser.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n'))
    await new Promise<void>(resolve => refuser.listen(0, '127.0.0.1', resolve))
    const refuserPort = (refuser.address() as AddressInfo).port
    const refusedCrew = createServer()
    await new Promise<void>(resolve => refusedCrew.listen(0, '127.0.0.1', resolve))
    const savedCrew = crew
    const savedPort = port
    try {
      crew = refusedCrew
      port = (refusedCrew.address() as AddressInfo).port
      startCrew(`http://127.0.0.1:${refuserPort}`)
      expect((await closeInfo(await connect())).code).toBe(4403)
    } finally {
      refusedCrew.closeAllConnections()
      await new Promise<void>(resolve => refusedCrew.close(() => resolve()))
      await new Promise<void>(resolve => refuser.close(() => resolve()))
    }
    const dead = createServer()
    await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve))
    const deadPort = (dead.address() as AddressInfo).port
    await new Promise<void>(resolve => dead.close(() => resolve()))
    crew = savedCrew
    port = savedPort
    const deadCrew = createServer()
    await new Promise<void>(resolve => deadCrew.listen(0, '127.0.0.1', resolve))
    try {
      crew = deadCrew
      port = (deadCrew.address() as AddressInfo).port
      startCrew(`http://127.0.0.1:${deadPort}`)
      expect((await closeInfo(await connect())).code).toBe(1013)
    } finally {
      deadCrew.closeAllConnections()
      await new Promise<void>(resolve => deadCrew.close(() => resolve()))
      crew = savedCrew
      port = savedPort
    }
  })

  it('never logs the ticket', async () => {
    const dead = createServer()
    await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve))
    const deadPort = (dead.address() as AddressInfo).port
    await new Promise<void>(resolve => dead.close(() => resolve()))
    const other = createServer()
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve))
    const savedCrew = crew
    const savedPort = port
    try {
      crew = other
      port = (other.address() as AddressInfo).port
      startCrew(`http://127.0.0.1:${deadPort}`)
      await closeInfo(await connect())
    } finally {
      other.closeAllConnections()
      await new Promise<void>(resolve => other.close(() => resolve()))
      crew = savedCrew
      port = savedPort
    }
    expect(logLines.join('\n')).not.toContain('SECRET')
    expect(logLines.join('\n')).not.toContain(TICKET)
  })
})

describe('upstream handshake timeout', () => {
  it('ends a hung upgrade with 1013', async () => {
    const hung = createServer()
    const stuck: Duplex[] = []
    hung.on('upgrade', (_req, socket) => { stuck.push(socket) }) // accepts TCP, never answers
    await new Promise<void>(resolve => hung.listen(0, '127.0.0.1', resolve))
    const wss = new WebSocketServer({ noServer: true })
    const front = createServer()
    front.on('upgrade', (req, socket, head) => wss.handleUpgrade(req, socket, head, client =>
      attachDisplayBridge(client, req, { config: loadConfig({ HOME: '/home/ali', CREW_HERMES_URL: `http://127.0.0.1:${(hung.address() as AddressInfo).port}` }), handshakeTimeoutMs: 100 })))
    await new Promise<void>(resolve => front.listen(0, '127.0.0.1', resolve))
    try {
      const ws = new WebSocket(`ws://127.0.0.1:${(front.address() as AddressInfo).port}/api/display/ws?display_ticket=t`)
      expect((await closeInfo(ws)).code).toBe(1013)
    } finally {
      front.closeAllConnections()
      for (const socket of stuck) socket.destroy() // upgraded sockets are outside closeAllConnections
      await new Promise<void>(resolve => front.close(() => resolve()))
      await new Promise<void>(resolve => hung.close(() => resolve()))
    }
  })
})

class FakeSocket extends EventEmitter {
  bufferedAmount = 0
  readyState = WebSocket.OPEN
  paused = 0
  resumed = 0
  sent: Buffer[] = []
  pause(): void { this.paused += 1 }
  resume(): void { this.resumed += 1 }
  send(data: unknown): void { this.sent.push(data as Buffer) }
}

describe('relay backpressure', () => {
  it('resumes a paused source when the sink closes', () => {
    const source = new FakeSocket()
    const sink = new FakeSocket()
    relay(source as unknown as Pausable, sink as unknown as Pausable)
    sink.bufferedAmount = 2 * 1024 * 1024
    source.emit('message', Buffer.from([1]), true)
    expect(source.paused).toBe(1)
    sink.emit('close')
    expect(source.resumed).toBe(1)
  })

  it('pauses the reader under backpressure and resumes when drained', async () => {
    const source = new FakeSocket()
    const sink = new FakeSocket()
    relay(source as unknown as Pausable, sink as unknown as Pausable)
    sink.bufferedAmount = 1024 * 1024
    source.emit('message', Buffer.from([1]), true)
    expect(source.paused).toBe(0) // exactly 1 MiB is not above the limit
    sink.bufferedAmount = 1024 * 1024 + 1
    source.emit('message', Buffer.from([2]), true)
    expect(source.paused).toBe(1)
    sink.bufferedAmount = 300 * 1024 // above the 256 KiB low-water mark: stay paused
    await new Promise(r => setTimeout(r, 60))
    expect(source.resumed).toBe(0)
    sink.bufferedAmount = 256 * 1024 - 1
    await new Promise(r => setTimeout(r, 60))
    expect(source.resumed).toBe(1)
    source.emit('message', Buffer.from([3]), true)
    expect(sink.sent).toHaveLength(3)
  })
})
