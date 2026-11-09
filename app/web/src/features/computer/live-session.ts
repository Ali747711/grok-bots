import type { DisplayLease } from '@/vendor/hermes/gateway-contract.generated'

import * as display from './display-client'
import { openStream } from './session-stream'
import type { RfbCtor, RfbLike, SessionOptions, SessionUi, Viewer } from './session-types'
import { BUDGET_SPENT, HIDDEN_DETACH_MS, MAX_SECURITY_STRIKES, NO_SECURE_CONTEXT, SECURITY_REFUSED, SECURITY_RETRY_MS, Timers, classifyConnectError, heldBy, messageOf, viewerHash } from './session-utils'

export type { LinkState } from './session-types'

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
  /** The current stream reached RFB `connect`: detaching it on purpose gives its dial back. */
  private reachedConnect = false
  private pasteOff: (() => void) | null = null
  private readonly timers = new Timers()
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
    // A host swap (panel to Expand) is a plain detach of the old stream, so it cannot outlive a refused dial.
    if (this.host && this.host !== el) this.stopStreams()
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
  detach(el?: HTMLElement): void {
    // A closing Expand dialog can unmount its host after the panel's host already attached: that late
    // detach must not tear down the new connection.
    if (el && this.host !== el) return
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

  /** A deliberate plain detach: give the dial back if the stream had connected (C1, R5). */
  private refundIfConnected(): void {
    if (this.reachedConnect) this.options.budget.refund(this.profile)
    this.reachedConnect = false
  }

  /** The owner is leaving (tab switch, panel close, bot switch): hand back if the lease is ours, then close 1000. */
  dispose(): void {
    this.pendingDetach = false
    this.disposed = true
    const viewer = this.viewer
    if (viewer && (this.ui.holding() || this.leaseIsOurs(this.lastLease))) void this.giveBack(this.releaseTarget(viewer))
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
    // While watching, the canvas must not take focus (a keyboard trap for Tab and Escape).
    this.rfb.focusOnClick = holding
    if (holding) this.rfb.focus()
    else this.rfb.blur()
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
    if (this.disposed) {
      // The owner left while this acquire was in flight: give back what it just took.
      if (heldBy(lease, viewer.hash)) await this.giveBack(viewer.epoch === this.gatewayEpoch ? viewer.id : { force: true })
      return
    }
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

  /** Release the lease and swallow a refusal: the bridge hands back on the 1000 close as well. */
  private async giveBack(target: string | { force: true }): Promise<void> {
    try {
      await display.release(this.profile, target)
    } catch {
      // Nothing more to do while leaving.
    }
  }

  private async guarded(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (error) {
      this.ui.setNotice(messageOf(error))
    }
  }

  private scheduleDial(): void {
    this.timers.clear('redial')
    if (!this.host) return
    const decision = this.options.budget.request(this.profile)
    if (decision.allowed) {
      void this.connect()
      return
    }
    if (decision.reason === 'mounting') {
      this.ui.setLink(this.everLive ? 'reconnecting' : 'connecting')
      this.timers.set('redial', () => this.scheduleDial(), decision.retryInMs)
      return
    }
    this.fail(BUDGET_SPENT)
  }

  private async connect(): Promise<void> {
    const generation = ++this.generation
    this.reachedConnect = false
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
      if (this.disposed) return void (heldBy(lease, hash) && this.giveBack({ force: true }))
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
    const stream = openStream(Rfb, this.host!, ticket, controlling, {
      onConnect: () => {
        if (generation !== this.generation) return
        this.everLive = true
        this.reachedConnect = true
        this.securityStrikes = 0
        this.ui.setLink('live')
      },
      onSecurityFailure: () => this.onSecurityFailure(generation),
      onClosed: code => this.onClosed(generation, code),
      onNotice: message => this.ui.setNotice(message)
    })
    this.ws = stream.ws
    this.rfb = stream.rfb
    this.pasteOff = stream.pasteOff
  }

  /** §11 R3: what each pixel-socket close means. */
  private onClosed(generation: number, code: number): void {
    if (generation !== this.generation) return
    this.generation += 1
    this.reachedConnect = false // server-initiated: the dial stays spent (R4)
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
    // A null read (failed or overtaken) is unknown, not stopped: read once more before giving up.
    const status = (await this.ui.refresh()) ?? (await this.ui.refresh())
    if (generation === this.generation && status?.running && this.host) this.scheduleDial()
  }

  /** Xvnc is locking viewers out: wait for it to clear and redial; a second strike in a row gives up (R3). */
  private onSecurityFailure(generation: number): void {
    if (generation !== this.generation) return
    this.generation += 1
    this.reachedConnect = false
    this.teardown()
    this.securityStrikes += 1
    if (this.securityStrikes >= MAX_SECURITY_STRIKES) return this.fail(SECURITY_REFUSED)
    this.ui.setLink('reconnecting')
    this.timers.set('security', () => this.scheduleDial(), this.options.securityRetryMs ?? SECURITY_RETRY_MS)
  }

  private fail(message: string): void {
    this.ui.setLink('failed')
    this.ui.setError(message)
  }

  private startHiddenTimer(): void {
    if (this.timers.has('hidden') || !this.host) return
    // A forgotten tab must not defeat the idle stop: detach (lease kept) after five hidden minutes (R5).
    this.timers.set('hidden', () => this.suspend(), this.options.hiddenDetachMs ?? HIDDEN_DETACH_MS)
  }

  private readonly onVisibility = (): void => {
    if (document.visibilityState === 'hidden') return this.startHiddenTimer()
    this.timers.clear('hidden')
    if (this.suspended) {
      this.suspended = false
      this.scheduleDial()
    }
  }

  private suspend(): void {
    this.timers.clear('hidden')
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
    this.refundIfConnected() // every caller is a deliberate detach, and a connected stream is safe for Xvnc
    this.generation += 1
    this.timers.clear('redial')
    this.timers.clear('security')
    this.teardown()
  }

  private stopAll(): void {
    this.stopStreams()
    this.timers.clear('hidden')
    document.removeEventListener('visibilitychange', this.onVisibility)
  }
}
