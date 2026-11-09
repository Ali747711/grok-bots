import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { connectGateway } from '@/chat/gateway'
import type { DisplayLease } from '@/vendor/hermes/gateway-contract.generated'

import { type DialBudget, pageDialBudget } from './dial-budget'
import { type LinkState, LiveSession } from './live-session'
import { type UseScreen, useScreen } from './use-screen'

export type { LinkState } from './live-session'

export interface LiveHandle {
  readonly attach: (el: HTMLElement) => void
  readonly detach: (el?: HTMLElement) => void
  readonly takeControl: () => Promise<void>
  readonly handBack: () => Promise<void>
  readonly forceHandBack: () => Promise<void>
  readonly reconnect: () => void
  readonly link: LinkState
  readonly error: string | null
  /** A short, non-fatal message (clipboard permission, paste too large). */
  readonly notice: string | null
}

export interface LiveViewOptions {
  /** Defaults to the page-wide budget (3 dials per bot per 10 s); tests pass their own. */
  readonly budget?: DialBudget
}

/**
 * The viewer of one bot's screen. Call it in the OWNER (the Computer panel), not in the canvas
 * component: `<LiveView>` only attaches and detaches the host, so moving it between the panel and
 * Expand reconnects without handing control back (§11 C1). When the owner itself unmounts, the lease
 * is released if we hold it and the socket closes 1000.
 */
export function useLiveView(profile: string, screen: UseScreen, setOurs: (hashes: ReadonlySet<string>) => void, options: LiveViewOptions = {}): LiveHandle {
  const [link, setLink] = useState<LinkState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const latest = useRef({ screen, setOurs })
  latest.current = { screen, setOurs }
  const budget = options.budget ?? pageDialBudget

  const session = useMemo(
    () => new LiveSession(profile, {
      setLink,
      setError,
      setNotice,
      onOurs: hashes => latest.current.setOurs(hashes),
      onLease: (lease: DisplayLease) => latest.current.screen.applyLease(lease),
      refresh: () => latest.current.screen.refresh(),
      holding: () => latest.current.screen.view.control === 'you'
    }, { budget }),
    [profile, budget]
  )

  // No state resets here: a new session is a fresh start, and resetting after the child's attach
  // effect would erase its 'connecting' (the skeleton).
  useEffect(() => {
    const off = connectGateway().onState(state => session.noteGateway(state))
    return () => {
      off()
      session.dispose()
    }
  }, [session])

  const holding = screen.view.control === 'you'
  useEffect(() => session.setHolding(holding), [session, holding])
  const lease = screen.view.lease
  useEffect(() => session.noteLease(lease), [session, lease])

  const attach = useCallback((el: HTMLElement) => session.attach(el), [session])
  const detach = useCallback((el?: HTMLElement) => session.detach(el), [session])
  const takeControl = useCallback(() => session.takeControl(), [session])
  const handBack = useCallback(() => session.handBack(), [session])
  const forceHandBack = useCallback(() => session.forceHandBack(), [session])
  const reconnect = useCallback(() => session.reconnect(), [session])
  return { attach, detach, takeControl, handBack, forceHandBack, reconnect, link, error, notice }
}

/** Screen state plus the viewer, wired together: the viewer's lease hash makes `view.control` read `'you'`. */
export function useComputer(profile: string, options: LiveViewOptions = {}): { screen: UseScreen; live: LiveHandle } {
  const [ours, setOurs] = useState<ReadonlySet<string>>(new Set())
  const screen = useScreen(profile, ours)
  const live = useLiveView(profile, screen, setOurs, options)
  return { screen, live }
}
