import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { connectGateway } from '@/chat/gateway'
import type { DisplayLease } from '@/vendor/hermes/gateway-contract.generated'

import { type DialBudget, pageDialBudget } from './dial-budget'
import { type LinkState, LiveSession } from './live-session'
import { type UseScreen, useScreen } from './use-screen'

export type { LinkState } from './live-session'

export interface LiveHandle {
  readonly attach: (el: HTMLElement) => void
  readonly detach: () => void
  readonly takeControl: () => Promise<void>
  readonly handBack: () => Promise<void>
  readonly forceHandBack: () => Promise<void>
  readonly reconnect: () => void
  readonly link: LinkState
  readonly error: string | null
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
export function useLiveView(profile: string, screen: UseScreen, setOurHash: (hash: string | null) => void, options: LiveViewOptions = {}): LiveHandle {
  const [link, setLink] = useState<LinkState>('idle')
  const [error, setError] = useState<string | null>(null)
  const latest = useRef({ screen, setOurHash })
  latest.current = { screen, setOurHash }
  const budget = options.budget ?? pageDialBudget

  const session = useMemo(
    () => new LiveSession(profile, {
      setLink,
      setError,
      onHash: hash => latest.current.setOurHash(hash),
      onLease: (lease: DisplayLease) => latest.current.screen.applyLease(lease),
      refresh: () => void latest.current.screen.refresh(),
      holding: () => latest.current.screen.view.control === 'you'
    }, { budget }),
    [profile, budget]
  )

  useEffect(() => {
    setOurHash(null)
    setLink('idle')
    setError(null)
    const off = connectGateway().onState(state => session.noteGateway(state))
    return () => {
      off()
      session.dispose()
    }
  }, [session, setOurHash])

  const holding = screen.view.control === 'you'
  useEffect(() => session.setHolding(holding), [session, holding])

  const attach = useCallback((el: HTMLElement) => session.attach(el), [session])
  const detach = useCallback(() => session.detach(), [session])
  const takeControl = useCallback(() => session.takeControl(), [session])
  const handBack = useCallback(() => session.handBack(), [session])
  const forceHandBack = useCallback(() => session.forceHandBack(), [session])
  const reconnect = useCallback(() => session.reconnect(), [session])
  return { attach, detach, takeControl, handBack, forceHandBack, reconnect, link, error }
}

/** Screen state plus the viewer, wired together: the viewer's lease hash makes `view.control` read `'you'`. */
export function useComputer(profile: string, options: LiveViewOptions = {}): { screen: UseScreen; live: LiveHandle } {
  const [ourHash, setOurHash] = useState<string | null>(null)
  const screen = useScreen(profile, ourHash)
  const live = useLiveView(profile, screen, setOurHash, options)
  return { screen, live }
}
