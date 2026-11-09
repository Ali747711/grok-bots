import type { IncomingMessage } from 'node:http'
import type { EventEmitter } from 'node:events'

import { type RawData, WebSocket } from 'ws'

import type { CrewConfig } from '../config.js'
import { log } from '../log.js'
import { closeReason, forwardableCode } from './close-codes.js'

export interface DisplayProxyDeps {
  readonly config: CrewConfig
  /** Test hook; production uses the 10 s default. */
  readonly handshakeTimeoutMs?: number
}

const UPSTREAM_PATH = '/api/display/ws'
/** Browser→Hermes frames are small RFB input messages; Hermes itself closes above 256 KiB of paste. */
export const DISPLAY_CLIENT_MAX_PAYLOAD = 1024 * 1024
const UPSTREAM_MAX_PAYLOAD = 16 * 1024 * 1024
const HIGH_WATER = 1024 * 1024
const LOW_WATER = 256 * 1024
const POLL_MS = 20
const HANDSHAKE_TIMEOUT_MS = 10_000
const NO_TICKET = 4401
const SCREEN_REFUSED = 4403
const TRY_AGAIN_LATER = 1013

/** The slice of a ws socket that backpressure needs; also what tests fake. */
export interface Pausable extends EventEmitter {
  readonly bufferedAmount: number
  readonly readyState: number
  pause(): void
  resume(): void
  send(data: RawData, opts: { binary: boolean }): void
}

/**
 * Relay frames `source` → `sink`. While the sink holds more than 1 MiB unsent the source is paused
 * (the TCP window then slows Hermes), and it resumes below 256 KiB, checked every 20 ms.
 */
export function relay(source: Pausable, sink: Pausable): void {
  let timer: NodeJS.Timeout | null = null
  const drain = (): void => {
    if (sink.bufferedAmount > LOW_WATER && sink.readyState === WebSocket.OPEN) return
    if (timer) clearInterval(timer)
    timer = null
    source.resume()
  }
  source.on('message', (data: RawData, isBinary: boolean) => {
    if (sink.readyState !== WebSocket.OPEN) return
    sink.send(data, { binary: isBinary })
    if (!timer && sink.bufferedAmount > HIGH_WATER) {
      source.pause()
      timer = setInterval(drain, POLL_MS)
    }
  })
  const stop = (): void => {
    if (timer) clearInterval(timer)
    timer = null
    // A paused source never reads its own close frame, so a close would wait for ws's 30 s timer.
    // Resuming is a no-op on a closed socket.
    source.resume()
  }
  source.on('close', stop)
  sink.on('close', stop)
}

function upstreamUrl(config: CrewConfig, ticket: string): string {
  return `${config.hermesUrl.replace(/^http/, 'ws')}${UPSTREAM_PATH}?display_ticket=${encodeURIComponent(ticket)}`
}

/**
 * Splice one browser pixel socket to Hermes's `/api/display/ws`. Only `display_ticket` is forwarded:
 * no Origin (Hermes answers 403 to ours), no cookie, no token. The caller has already passed the
 * Host/Origin/session guard.
 */
export function attachDisplayBridge(client: WebSocket, req: IncomingMessage, deps: DisplayProxyDeps): void {
  client.on('error', () => client.terminate())
  const ticket = new URL(req.url ?? '/', 'http://crew.invalid').searchParams.get('display_ticket')
  if (!ticket) {
    client.close(NO_TICKET, 'display ticket missing')
    return
  }
  let upstream: WebSocket
  try {
    upstream = new WebSocket(upstreamUrl(deps.config, ticket), { perMessageDeflate: false, maxPayload: UPSTREAM_MAX_PAYLOAD, handshakeTimeout: deps.handshakeTimeoutMs ?? HANDSHAKE_TIMEOUT_MS })
  } catch (error) {
    log.warn('hermes display socket unavailable', { error: error instanceof Error ? error.name : 'unknown' })
    client.close(TRY_AGAIN_LATER, 'hermes unavailable')
    return
  }
  // Browser frames sent before upstream opens are dropped: harmless, because the RFB server speaks
  // first and noVNC waits for its banner before sending anything.
  relay(client as unknown as Pausable, upstream as unknown as Pausable)
  relay(upstream as unknown as Pausable, client as unknown as Pausable)

  client.on('close', code => {
    // A clean browser close ends the view; anything else is a dropped link, which must not release
    // the lease, so the upstream is cut without a close frame (facts 2.3: 1006 keeps the lease).
    if ((code === 1000 || code === 1001) && upstream.readyState === WebSocket.OPEN) upstream.close(1000)
    else upstream.terminate()
  })
  upstream.on('unexpected-response', (_req, res) => {
    res.resume()
    upstream.terminate()
    client.close(res.statusCode === 403 ? SCREEN_REFUSED : TRY_AGAIN_LATER, 'hermes refused the screen')
  })
  upstream.on('close', (code, reason) => {
    if (client.readyState === WebSocket.OPEN) client.close(forwardableCode(code), closeReason(reason.toString()))
  })
  upstream.on('error', error => {
    // Never log the message: a ws error can echo the URL, which carries the ticket.
    log.warn('hermes display socket error', { error: error.name })
    if (client.readyState === WebSocket.OPEN) client.close(TRY_AGAIN_LATER, 'hermes unavailable')
  })
}
