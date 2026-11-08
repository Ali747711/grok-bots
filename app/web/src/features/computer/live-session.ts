import type { DisplayLease } from '@/vendor/hermes/gateway-contract.generated'

import * as display from './display-client'
import { attachPaste } from './paste'
import type { RfbCtor, RfbLike, SessionOptions, SessionUi, TimerName, Viewer } from './session-types'
import { classifyConnectError, displayUrl, heldBy, messageOf, viewerHash } from './session-utils'

export type { LinkState } from './session-types'

const HIDDEN_DETACH_MS = 5 * 60_000
const SECURITY_RETRY_MS = 12_000
const MAX_SECURITY_STRIKES = 2
const NO_SECURE_CONTEXT = 'The screen needs a secure connection (https or localhost).'
const BUDGET_SPENT = "Couldn't reconnect to the screen. Try again."
const SECURITY_REFUSED = 'The screen refused the connection. Try again.'

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
  private ours: ReadonlySet<string> = new Set()
  private lastLease: DisplayLease | null = null
  private generation = 0
  private gatewayEpoch = 0
  private gatewayDown = false
  private awaitingGateway = false
  private wantControl = false
  private everLive = false
  private suspended = false
  private securityStrikes = 0
  private pasteOff: (() => void) | null = null
  private redialTimer: ReturnType<typeof setTimeout> | null = null
  private securityTimer: ReturnType<typeof setTimeout> | null = null
  private hiddenTimer: ReturnType<typeof setTimeout> | null = null
  private pendingDetach = false
  /** Set by `dispose` (the owner left), not by a plain detach such as the panel-to-Expand gap. */
  private disposed = false

  constructor(
    private readonly profile: string,
    private readonly ui: SessionUi,
    private readonly options: SessionOptions
  ) {}

  /** Mount the canvas host: dial through the shared budget (the first dial waits out the mount delay). */
  attach(el: HTMLElement): void {
    this.flushDetach()
    this.host = el
    this.disposed = false
    this.suspended = false
    this.options.budget.markMounted(this.profile)
    document.addEventListener('visibilitychange', this.onVisibility)
    if (document.visibilityState === 'hidden') this.startHiddenTimer()
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

  /** The owner is leaving (tab switch, panel close, bot switch): hand back if the lease is ours, then close 1000. */
  dispose(): void {
    this.pendingDetach = false
    this.disposed = true
    const viewer = this.viewer
    if (viewer && (this.ui.holding() || this.leaseIsOurs(this.lastLease))) void this.releaseQuietly(viewer)
    try {
      this.ws?.close(1000)
    } catch {
      // Already closing.
    }
    this.stopAll()
    this.host = null
    this.viewer = null
    this.wantControl = false
  }

  noteGateway(state: string): void {
    if (state !== 'open') {
      this.gatewayDown = true
      return
    }
    if (!this.gatewayDown) return
    this.gatewayDown = false
    this.gatewayEpoch += 1
    if (this.awaitingGateway) {
      this.awaitingGateway = false
      this.scheduleDial()
    }
  }

  /** A lease we did not cause moved: forget earlier viewers' hashes once the lease is no longer ours. */
  noteLease(lease: DisplayLease | null): void {
    this.lastLease = lease
    if (this.leaseIsOurs(lease) || this.ours.size <= (this.viewer ? 1 : 0)) return
    this.setOurs(new Set(this.viewer ? [this.viewer.hash] : []))
  }

  setHolding(holding: boolean): void {
    if (!this.rfb) return
    this.rfb.viewOnly = !holding
    if (holding) this.rfb.focus()
  }

  async takeControl(): Promise<void> {
    const viewer = this.viewer
    if (!viewer) return
    if (viewer.epoch !== this.gatewayEpoch) {
      // The gateway redialed since this id was minted: acquire would be refused, so re-attach first.
      this.wantControl = true
      this.scheduleDial()
      return
    }
    await this.guarded(() => this.acquireFor(viewer))
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
    this.securityStrikes = 0
    this.ui.setError(null)
    this.scheduleDial()
  }

  private leaseIsOurs(lease: DisplayLease | null | undefined): boolean {
    return lease?.holder === 'human' && !!lease.viewer_hash && this.ours.has(lease.viewer_hash)
  }

  private setOurs(next: ReadonlySet<string>): void {
    this.ours = next
    this.ui.onOurs(next)
  }

  private emitLease(lease: DisplayLease): void {
    this.lastLease = lease
    this.ui.onLease(lease)
  }

  private async acquireFor(viewer: Viewer): Promise<void> {
    const { lease } = await display.acquire(this.profile, viewer.id)
    this.emitLease(lease)
    this.ui.setNotice(null)
    this.setHolding(heldBy(lease, viewer.hash))
  }

  private async release(force: boolean): Promise<void> {
    const viewer = this.viewer
    await this.guarded(async () => {
      const { lease } = await display.release(this.profile, force || !viewer ? { force: true } : this.releaseTarget(viewer))
      this.emitLease(lease)
      this.setHolding(viewer ? heldBy(lease, viewer.hash) : false)
    })
  }

  /** An orphaned id (older gateway connection, or a lease still on an earlier hash of ours) can only be force-released (R2). */
  private releaseTarget(viewer: Viewer): string | { force: true } {
    const onEarlierHash = this.leaseIsOurs(this.lastLease) && this.lastLease?.viewer_hash !== viewer.hash
    return viewer.epoch !== this.gatewayEpoch || onEarlierHash ? { force: true } : viewer.id
  }

  private async releaseQuietly(viewer: Viewer): Promise<void> {
    try {
      await display.release(this.profile, this.releaseTarget(viewer))
    } catch {
      // Closing 1000 makes the bridge hand back as well.
    }
  }

  private releaseForced(): Promise<void> {
    return display.release(this.profile, { force: true }).then(() => undefined, () => undefined)
  }

  private async guarded(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (error) {
      this.ui.setNotice(messageOf(error))
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
    this.fail(BUDGET_SPENT)
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation
    this.teardown()
    this.ui.setLink(this.everLive ? 'reconnecting' : 'connecting')
    this.ui.setError(null)
    if (!globalThis.crypto?.subtle) return this.fail(NO_SECURE_CONTEXT)
    try {
      const Rfb = (await display.loadRfb()) as unknown as RfbCtor
      const prior = this.viewer
      const observed = await display.observe(this.profile, prior?.id)
      const hash = await viewerHash(observed.viewer_id)
      if (generation !== this.generation || !this.host) return
      const viewer = { id: observed.viewer_id, hash, epoch: this.gatewayEpoch }
      this.viewer = viewer
      this.setOurs(new Set([...this.ours, hash]))
      const lease = await this.reclaim(prior, viewer, observed.lease)
      // The owner left while the reclaim acquire was in flight: give back what it just took.
      if (this.disposed) return void (heldBy(lease, hash) && this.releaseForced())
      if (generation !== this.generation || !this.host) return
      this.emitLease(lease)
      this.open(Rfb, observed.ticket, generation, heldBy(lease, hash))
      if (this.wantControl) {
        this.wantControl = false
        // A refusal is a notice: the socket and RFB are open, so the view must not read as failed.
        await this.guarded(() => this.acquireFor(viewer))
      }
    } catch (error) {
      if (generation === this.generation) this.onConnectError(error)
    }
  }

  /** The pixel socket redialed after the gateway did: the lease still names an earlier hash of ours, so take it back at once (R2). */
  private async reclaim(prior: Viewer | null, viewer: Viewer, lease: DisplayLease): Promise<DisplayLease> {
    if (!prior || prior.hash === viewer.hash || !heldBy(lease, prior.hash)) return lease
    return (await display.acquire(this.profile, viewer.id)).lease
  }

  /** What a failed connect means: wait out a gateway outage, go idle if the screen went away, else give up. */
  private onConnectError(error: unknown): void {
    const kind = classifyConnectError(error)
    if (kind === 'not_running') {
      void this.ui.refresh()
      this.ui.setLink('idle')
    } else if (kind === 'transport') {
      this.ui.setLink('reconnecting')
      if (this.gatewayDown) this.awaitingGateway = true
      else this.scheduleDial()
    } else {
      this.fail(messageOf(error))
    }
  }

  private open(Rfb: RfbCtor, ticket: string, generation: number, controlling: boolean): void {
    const ws = new WebSocket(displayUrl(ticket))
    ws.binaryType = 'arraybuffer'
    this.ws = ws
    let closeCode = -1
    ws.addEventListener('close', event => {
      closeCode = (event as CloseEvent).code
      this.onClosed(generation, closeCode)
    })
    const rfb = new Rfb(this.host!, ws, { shared: true })
    Object.assign(rfb, { scaleViewport: true, resizeSession: false, focusOnClick: true, background: 'transparent', qualityLevel: 7, viewOnly: !controlling })
    rfb.addEventListener('connect', () => {
      if (generation !== this.generation) return
      this.everLive = true
      this.securityStrikes = 0
      this.ui.setLink('live')
    })
    rfb.addEventListener('securityfailure', () => this.onSecurityFailure(generation))
    rfb.addEventListener('disconnect', event => {
      const clean = (event as CustomEvent<{ clean?: boolean }>).detail?.clean === true
      this.onClosed(generation, closeCode >= 0 ? closeCode : clean ? 1000 : 1006)
    })
    this.rfb = rfb
    this.pasteOff = attachPaste(this.host!, rfb, message => this.ui.setNotice(message))
  }

  /** §11 R3: what each pixel-socket close means. */
  private onClosed(generation: number, code: number): void {
    if (generation !== this.generation) return
    this.generation += 1
    this.teardown()
    if (code === 1000 || code === 4001) {
      void this.afterCleanClose(this.generation)
    } else if (code === 1003 || code === 4403) {
      this.fail(code === 4403 ? 'Hermes refused the screen.' : 'The screen sent something Crew does not understand.')
    } else {
      this.ui.setLink('reconnecting')
      this.scheduleDial()
    }
  }

  /** The screen ended (or the bridge closed us cleanly): re-read it, and dial once more if it is still running. */
  private async afterCleanClose(generation: number): Promise<void> {
    this.ui.setLink('idle')
    const status = await this.ui.refresh()
    if (generation === this.generation && status?.running && this.host) this.scheduleDial()
  }

  /** Xvnc is locking viewers out: wait for it to clear and redial; a second strike in a row gives up (R3). */
  private onSecurityFailure(generation: number): void {
    if (generation !== this.generation) return
    this.generation += 1
    this.teardown()
    this.securityStrikes += 1
    if (this.securityStrikes >= MAX_SECURITY_STRIKES) return this.fail(SECURITY_REFUSED)
    this.ui.setLink('reconnecting')
    this.clearTimer('securityTimer')
    this.securityTimer = setTimeout(() => this.scheduleDial(), this.options.securityRetryMs ?? SECURITY_RETRY_MS)
  }

  private fail(message: string): void {
    this.ui.setLink('failed')
    this.ui.setError(message)
  }

  private startHiddenTimer(): void {
    if (this.hiddenTimer || !this.host) return
    // A forgotten tab must not defeat the idle stop: detach (lease kept) after five hidden minutes (R5).
    this.hiddenTimer = setTimeout(() => this.suspend(), this.options.hiddenDetachMs ?? HIDDEN_DETACH_MS)
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') return this.startHiddenTimer()
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

  private clearTimer(name: TimerName): void {
    const timer = this[name]
    if (timer) clearTimeout(timer)
    this[name] = null
  }
}
