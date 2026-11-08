import type { IncomingMessage, Server } from 'node:http'
import type { Duplex } from 'node:stream'

import { type RawData, WebSocket, WebSocketServer } from 'ws'

import type { CrewConfig } from '../config.js'
import { isAllowedUpgrade } from '../http/session-guard.js'
import { log } from '../log.js'
import { forwardableCode } from './close-codes.js'
import { DISPLAY_CLIENT_MAX_PAYLOAD, attachDisplayBridge } from './display-proxy.js'
import type { HermesToken } from './token.js'

export interface WsProxyDeps {
  readonly config: CrewConfig
  readonly token: HermesToken
  readonly cookieKey: Buffer
  readonly now: () => number
}

const PROXIED_PATH = '/api/ws'
const DISPLAY_PATH = '/api/display/ws'
const MAX_PENDING_FRAMES = 64
/** Far above any JSON-RPC frame; ws's 100 MiB default would let one client exhaust memory. */
const MAX_PAYLOAD_BYTES = 16 * 1024 * 1024
const SERVICE_RESTART = 1012
const TRY_AGAIN_LATER = 1013
const BAD_CREDENTIAL = 4401

function refuse(socket: Duplex, status: number, text: string): void {
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

function upstreamUrl(config: CrewConfig, token: string): string {
  const base = config.hermesUrl.replace(/^http/, 'ws')
  return `${base}${PROXIED_PATH}?token=${encodeURIComponent(token)}`
}

type Frame = { data: RawData; isBinary: boolean }

/** Wire one browser socket to a fresh upstream socket. Frames sent before upstream opens are buffered. */
async function bridge(client: WebSocket, deps: WsProxyDeps): Promise<void> {
  // Without an 'error' listener a malformed or oversized client frame throws and kills the process.
  client.on('error', () => client.terminate())
  let pending: readonly Frame[] = []
  let upstream: WebSocket
  try {
    upstream = new WebSocket(upstreamUrl(deps.config, await deps.token.get()))
  } catch (error) {
    log.warn('hermes websocket unavailable', { error: error instanceof Error ? error.name : 'unknown' })
    client.close(SERVICE_RESTART, 'hermes unavailable')
    return
  }

  client.on('message', (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) return upstream.send(data, { binary: isBinary })
    if (pending.length >= MAX_PENDING_FRAMES) return client.close(TRY_AGAIN_LATER, 'upstream not ready')
    pending = [...pending, { data, isBinary }]
  })
  client.on('close', () => {
    if (upstream.readyState === WebSocket.OPEN) upstream.close(1000)
    else upstream.terminate()
  })

  upstream.on('open', () => {
    for (const frame of pending) upstream.send(frame.data, { binary: frame.isBinary })
    pending = []
  })
  upstream.on('message', (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary })
  })
  upstream.on('unexpected-response', (_req, res) => {
    const rejected = res.statusCode === 401 || res.statusCode === 403
    if (rejected) void deps.token.refresh().catch(() => undefined)
    client.close(rejected ? BAD_CREDENTIAL : SERVICE_RESTART, 'hermes refused')
  })
  upstream.on('close', (code, reason) => {
    if (code === BAD_CREDENTIAL) void deps.token.refresh().catch(() => undefined)
    if (client.readyState === WebSocket.OPEN) client.close(forwardableCode(code), reason.toString().slice(0, 120))
  })
  upstream.on('error', error => {
    log.warn('hermes websocket error', { error: error.name })
    if (client.readyState === WebSocket.OPEN) client.close(SERVICE_RESTART, 'hermes unavailable')
  })
}

/** Handle WebSocket upgrades on the Crew server: only `/api/ws`, only with Host + Origin + session. */
export function attachWsProxy(server: Server, deps: WsProxyDeps): void {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD_BYTES })
  const displayWss = new WebSocketServer({ noServer: true, maxPayload: DISPLAY_CLIENT_MAX_PAYLOAD, perMessageDeflate: false })
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    // Node drops its own socket error listener before 'upgrade'; a client reset would otherwise crash us.
    socket.on('error', () => socket.destroy())
    const path = new URL(req.url ?? '/', 'http://crew.invalid').pathname
    if (path !== PROXIED_PATH && path !== DISPLAY_PATH) return refuse(socket, 404, 'Not Found')
    if (!isAllowedUpgrade(req, deps.config, deps.cookieKey, deps.now())) return refuse(socket, 403, 'Forbidden')
    if (path === DISPLAY_PATH) {
      return displayWss.handleUpgrade(req, socket, head, client => attachDisplayBridge(client, req, { config: deps.config }))
    }
    wss.handleUpgrade(req, socket, head, client => {
      void bridge(client, deps)
    })
  })
}
