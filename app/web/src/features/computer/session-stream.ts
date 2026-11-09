import { attachPaste } from './paste'
import type { RfbCtor, RfbLike } from './session-types'
import { displayUrl } from './session-utils'

export interface StreamHandlers {
  /** RFB reached `connect`. */
  onConnect(): void
  onSecurityFailure(): void
  /** The pixel socket or RFB ended; `code` is the WebSocket close code (1000 / 1006 when only RFB said so). */
  onClosed(code: number): void
  onNotice(message: string | null): void
}

export interface Stream {
  readonly ws: WebSocket
  readonly rfb: RfbLike
  readonly pasteOff: () => void
}

/**
 * Dial `/api/display/ws` with a minted ticket and mount noVNC on `host`. noVNC 1.7's disconnect detail
 * carries only `{clean}`, so the close code is taken from the raw socket first. `focusOnClick` follows
 * control: while only watching, the canvas must not trap Tab and Escape.
 */
export function openStream(Rfb: RfbCtor, host: HTMLElement, ticket: string, controlling: boolean, handlers: StreamHandlers): Stream {
  const ws = new WebSocket(displayUrl(ticket))
  ws.binaryType = 'arraybuffer'
  let closeCode = -1
  ws.addEventListener('close', event => {
    closeCode = (event as CloseEvent).code
    handlers.onClosed(closeCode)
  })
  const rfb = new Rfb(host, ws, { shared: true })
  Object.assign(rfb, { scaleViewport: true, resizeSession: false, focusOnClick: controlling, background: 'transparent', qualityLevel: 7, viewOnly: !controlling })
  rfb.addEventListener('connect', () => handlers.onConnect())
  rfb.addEventListener('securityfailure', () => handlers.onSecurityFailure())
  rfb.addEventListener('disconnect', event => {
    const clean = (event as CustomEvent<{ clean?: boolean }>).detail?.clean === true
    handlers.onClosed(closeCode >= 0 ? closeCode : clean ? 1000 : 1006)
  })
  return { ws, rfb, pasteOff: attachPaste(host, rfb, handlers.onNotice) }
}
