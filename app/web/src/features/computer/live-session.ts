import type { DisplayLease } from '@/vendor/hermes/gateway-contract.generated'

import type { DialBudget } from './dial-budget'
import * as display from './display-client'
import { attachPaste } from './paste'

export type LinkState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'failed'

/** What the session reports to its React owner. */
export interface SessionUi {
  setLink(link: LinkState): void
  setError(message: string | null): void
  onHash(hash: string): void
  onLease(lease: DisplayLease): void
  refresh(): void
  /** True while the lease names our viewer. */
  holding(): boolean
}

export interface SessionOptions {
  readonly budget: DialBudget
  readonly hiddenDetachMs?: number
  readonly securityRetryMs?: number
}

interface Viewer {
  readonly id: string
  readonly hash: string
  /** Which gateway connection minted the id; a redial orphans it (facts 1.4). */
  readonly epoch: number
}

interface RfbLike {
  viewOnly: boolean
  scaleViewport: boolean
  resizeSession: boolean
  focusOnClick: boolean
  background: string
  qualityLevel: number
  addEventListener(type: string, fn: (event: Event) => void): void
  disconnect(): void
  focus(): void
  clipboardPasteFrom(text: string): void
}

const HIDDEN_DETACH_MS = 5 * 60_000
const SECURITY_RETRY_MS = 12_000
const NO_SECURE_CONTEXT = 'The screen needs a secure connection (https or localhost).'
const BUDGET_SPENT = 'The screen connection kept dropping. Try Reconnect.'

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))
const heldBy = (lease: DisplayLease | null | undefined, hash: string): boolean => lease?.holder === 'human' && lease.viewer_hash === hash

async function viewerHash(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}

function displayUrl(ticket: string): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/display/ws?display_ticket=${encodeURIComponent(ticket)}`
}

/**
 * One viewer of one bot's screen: the pixel socket, the RFB client, the viewer id and the redial
 * policy. Plain class (no React) so the C1/R2-R5 rules read in one place. `detach` is a plain
 * disconnect that keeps control; only `dispose` (the owner leaving) hands back and closes 1000.
 */
export class LiveSession {
  private host: HTMLElement | null = null
  private rfb: RfbLike | null = null
  private ws: WebSocket | null = null
  private viewer: Viewer | null = null
  private generation = 0
  private gatewayEpoch = 0
  private gatewayDown = false
  private everLive = false
  private suspended = false
  private pasteOff: (() => void) | null = null
  private redialTimer: ReturnType<typeof setTimeout> | null = null
  private securityTimer: ReturnType<typeof setTimeout> | null = null
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null
  private pendingDetach = false

  constructor(
    private readonly profile: string,
    private readonly ui: SessionUi,
    private readonly options: SessionOptions
  ) {}

  /** Mount the canvas host: dial through the shared budget (the first dial waits out the mount delay). */
  attach(el: HTMLElement): void {
    this.flushDetach()
    this.host = el
    this.suspended = false
    this.options.budget.markMounted(this.profile)
    document.addEventListener('visibilitychange', this.onVisibility)
    this.scheduleDial()
  }

  /**
   * The host unmounted (panel to Expand, say): a plain disconnect, no release, no close(1000), so
   * control is kept. Deferred one microtask so an owner leaving in the same commit can still
   * `dispose` with a clean 1000 close.
   */
  detach(): void {
    this.pendingDetach = true
    void Promise.resolve().then(() => this.flushDetach())
  }

  private flushDetach(): void {
    if (!this.pendingDetach) return
    this.pendingDetach = false
    this.stopAll()
    this.host = null
    this.ui.setLink('idle')
  }

  /** The owner is leaving (tab switch, panel close, bot switch): hand back if held, then close 1000. */
  dispose(): void {
    this.pendingDetach = false
    const viewer = this.viewer
    if (viewer && this.ui.holding()) void this.releaseQuietly(viewer)
    try {
      this.ws?.close(1000)
    } catch {
      // Already closing.
    }
    this.stopAll()
    this.host = null
    this.viewer = null
  }

  noteGateway(state: string): void {
    if (state !== 'open') this.gatewayDown = true
    else if (this.gatewayDown) {
      this.gatewayDown = false
      this.gatewayEpoch += 1
    }
  }

  setHolding(holding: boolean): void {
    if (!this.rfb) return
    this.rfb.viewOnly = !holding
    if (holding) this.rfb.focus()
  }

  async takeControl(): Promise<void> {
    const viewer = this.viewer
    if (!viewer) return
    await this.guarded(async () => {
      const { lease } = await display.acquire(this.profile, viewer.id)
      this.ui.onLease(lease)
      this.setHolding(heldBy(lease, viewer.hash))
    })
  }

  handBack(): Promise<void> {
    return this.release(false)
  }

  forceHandBack(): Promise<void> {
    return this.release(true)
  }

  /** Manual Reconnect after the budget ran out. */
  reconnect(): void {
    this.options.budget.reset(this.profile)
    this.ui.setError(null)
    this.scheduleDial()
  }

  private async release(force: boolean): Promise<void> {
    const viewer = this.viewer
    await this.guarded(async () => {
      const { lease } = await display.release(this.profile, force || !viewer ? { force: true } : this.releaseTarget(viewer))
      this.ui.onLease(lease)
      this.setHolding(viewer ? heldBy(lease, viewer.hash) : false)
    })
  }

  /** After a gateway redial our id is orphaned, so a release by id would be refused: force it (R2). */
  private releaseTarget(viewer: Viewer): string | { force: true } {
    return viewer.epoch === this.gatewayEpoch ? viewer.id : { force: true }
  }

  private async releaseQuietly(viewer: Viewer): Promise<void> {
    try {
      await display.release(this.profile, this.releaseTarget(viewer))
    } catch {
      // Closing 1000 below makes the bridge hand back as well.
    }
  }

  private async guarded(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (error) {
      this.ui.setError(messageOf(error))
    }
  }

  private scheduleDial(): void {
    this.clearTimer('redialTimer')
    if (!this.host) return
    const decision = this.options.budget.request(this.profile)
    if (decision.allowed) {
      void this.connect()
      return
    }
    if (decision.reason === 'mounting') {
      this.ui.setLink(this.everLive ? 'reconnecting' : 'connecting')
      this.redialTimer = setTimeout(() => this.scheduleDial(), decision.retryInMs)
      return
    }
    this.ui.setLink('failed')
    this.ui.setError(BUDGET_SPENT)
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation
    this.teardown()
    this.ui.setLink(this.everLive ? 'reconnecting' : 'connecting')
    this.ui.setError(null)
    if (!globalThis.crypto?.subtle) return this.fail(NO_SECURE_CONTEXT)
    try {
      const Rfb = await display.loadRfb()
      const prior = this.viewer
      const observed = await display.observe(this.profile, prior?.id)
      const hash = await viewerHash(observed.viewer_id)
      if (generation !== this.generation || !this.host) return
      this.viewer = { id: observed.viewer_id, hash, epoch: this.gatewayEpoch }
      this.ui.onHash(hash)
      const lease = await this.reclaim(prior, observed.viewer_id, hash, observed.lease)
      if (generation !== this.generation || !this.host) return
      this.ui.onLease(lease)
      this.open(Rfb as unknown as new (el: HTMLElement, ws: WebSocket, o: object) => RfbLike, observed.ticket, generation, heldBy(lease, hash))
    } catch (error) {
      if (generation === this.generation) this.fail(messageOf(error))
    }
  }

  /** The pixel socket redialed after the gateway did: the lease still names our OLD hash, so take it back at once (R2). */
  private async reclaim(prior: Viewer | null, id: string, hash: string, lease: DisplayLease): Promise<DisplayLease> {
    if (!prior || prior.hash === hash || !heldBy(lease, prior.hash)) return lease
    return (await display.acquire(this.profile, id)).lease
  }

  private open(Rfb: new (el: HTMLElement, ws: WebSocket, o: object) => RfbLike, ticket: string, generation: number, controlling: boolean): void {
    const ws = new WebSocket(displayUrl(ticket))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    let closeCode = -1
    ws.addEventListener('close', event => {
      closeCode = (event as CloseEvent).code
      this.onClosed(generation, closeCode)
    })
    const rfb = new Rfb(this.host!, ws, { shared: true })
    rfb.scaleViewport = true
    rfb.resizeSession = false
    rfb.focusOnClick = true
    rfb.background = 'transparent'
    rfb.qualityLevel = 7
    rfb.viewOnly = !controlling
    rfb.addEventListener('connect', () => {
      if (generation !== this.generation) return
      this.everLive = true
      this.ui.setLink('live')
    })
    rfb.addEventListener('securityfailure', () => this.onSecurityFailure(generation))
    rfb.addEventListener('disconnect', event => {
      const clean = (event as CustomEvent<{ clean?: boolean }>).detail?.clean === true
      this.onClosed(generation, closeCode >= 0 ? closeCode : clean ? 1000 : 1006)
    })
    this.rfb = rfb
    this.pasteOff = attachPaste(this.host!, rfb)
  }

  /** §11 R3: what each pixel-socket close means. */
  private onClosed(generation: number, code: number): void {
    if (generation !== this.generation) return
    this.generation += 1
    this.teardown()
    if (code === 1000 || code === 4001) {
      this.ui.refresh()
      this.ui.setLink('idle')
    } else if (code === 1003 || code === 4403) {
      this.fail(code === 4403 ? 'Hermes refused the screen.' : 'The screen sent something Crew does not understand.')
    } else {
      this.ui.setLink('reconnecting')
      this.scheduleDial()
    }
  }

  /** Xvnc is locking viewers out: wait for it to clear, then redial once (R3). */
  private onSecurityFailure(generation: number): void {
    if (generation !== this.generation) return
    this.generation += 1
    this.teardown()
    this.ui.setLink('reconnecting')
    this.clearTimer('securityTimer')
    this.securityTimer = setTimeout(() => this.scheduleDial(), this.options.securityRetryMs ?? SECURITY_RETRY_MS)
  }

  private fail(message: string): void {
    this.ui.setLink('failed')
    this.ui.setError(message)
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      if (this.hiddenTimer || !this.host) return
      // A forgotten tab must not defeat the idle stop: detach (lease kept) after five hidden minutes (R5).
      this.hiddenTimer = setTimeout(() => this.suspend(), this.options.hiddenDetachMs ?? HIDDEN_DETACH_MS)
      return
    }
    this.clearTimer('hiddenTimer')
    if (this.suspended) {
      this.suspended = false
      this.scheduleDial()
    }
  }

  private suspend(): void {
    this.hiddenTimer = null
    this.suspended = true
    this.stopStreams()
    this.ui.setLink('idle')
  }

  private teardown(): void {
    this.pasteOff?.()
    this.pasteOff = null
    const rfb = this.rfb
    const ws = this.ws
    this.rfb = null
    this.ws = null
    try {
      rfb?.disconnect()
      ws?.close()
    } catch {
      // Already closed.
    }
  }

  /** Stop the stream and any pending redial; keep listening for visibility. */
  private stopStreams(): void {
    this.generation += 1
    this.clearTimer('redialTimer')
    this.clearTimer('securityTimer')
    this.teardown()
  }

  private stopAll(): void {
    this.stopStreams()
    this.clearTimer('hiddenTimer')
    document.removeEventListener('visibilitychange', this.onVisibility)
  }

  private clearTimer(name: 'redialTimer' | 'securityTimer' | 'hiddenTimer'): void {
    const timer = this[name]
    if (timer) clearTimeout(timer)
    this[name] = null
  }
}
