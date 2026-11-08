import type { DisplayLease } from '@/vendor/hermes/gateway-contract.generated'

import type { DialBudget } from './dial-budget'

export type LinkState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'failed'

/** What the session reports to its React owner. */
export interface SessionUi {
  setLink(link: LinkState): void
  setError(message: string | null): void
  setNotice(message: string | null): void
  /** Every lease hash that is ours (this viewer's and earlier ones of this view) until the lease moves off them. */
  onOurs(hashes: ReadonlySet<string>): void
  onLease(lease: DisplayLease): void
  /** Re-read `display.status`; resolves with it (null when the read failed). */
  refresh(): Promise<{ running: boolean } | null>
  /** True while the lease names one of our viewers. */
  holding(): boolean
}

export interface SessionOptions {
  readonly budget: DialBudget
  readonly hiddenDetachMs?: number
  readonly securityRetryMs?: number
}

export interface Viewer {
  readonly id: string
  readonly hash: string
  /** Which gateway connection minted the id; a redial orphans it (facts 1.4). */
  readonly epoch: number
}

export interface RfbLike {
  viewOnly: boolean
  scaleViewport: boolean
  resizeSession: boolean
  focusOnClick: boolean
  background: string
  qualityLevel: number
  addEventListener(type: string, fn: (event: Event) => void): void
  disconnect(): void
  focus(): void
  blur(): void
  clipboardPasteFrom(text: string): void
  sendKey(keysym: number, code: string | null, down?: boolean): void
}
export type RfbCtor = new (el: HTMLElement, ws: WebSocket, o: object) => RfbLike
export type TimerName = 'redialTimer' | 'securityTimer' | 'hiddenTimer'
