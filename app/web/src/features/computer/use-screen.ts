import { useCallback, useEffect, useRef, useState } from 'react'

import { connectGateway } from '@/chat/gateway'
import { startScreen } from '@/lib/crew-api'
import type { DisplayLease, DisplayStatus } from '@/vendor/hermes/gateway-contract.generated'

import * as display from './display-client'
import { type ScreenView, deriveScreen, isOlderLease } from './screen-state'

export interface UseScreen {
  readonly view: ScreenView
  readonly refresh: () => Promise<void>
  /** Apply a lease returned by acquire/release right away; an older epoch than the one held is ignored. */
  readonly applyLease: (lease: DisplayLease) => void
  readonly start: () => Promise<void>
  readonly stop: () => Promise<void>
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

interface EventShape {
  readonly type?: string
  readonly payload?: { profile_key?: string; lease?: DisplayLease } & Partial<DisplayStatus>
}

/**
 * The screen state of one bot: `display.status {profile}` plus the `display.*` events, which Hermes
 * broadcasts for every bot and so are filtered by `profile_key`. A gateway reconnect re-reads the
 * status, since events missed while down are not replayed (facts 1.3).
 */
export function useScreen(profile: string, ourLeaseHash?: string | null): UseScreen {
  const [status, setStatus] = useState<DisplayStatus | null>(null)
  const [lease, setLease] = useState<DisplayLease | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Each read or event takes a ticket; a reply holding an older ticket is dropped.
  const ticket = useRef(0)
  const profileKey = useRef<string | null>(null)

  const apply = useCallback((next: DisplayStatus) => {
    ticket.current += 1
    profileKey.current = next.profile_key
    setStatus(next)
    // A status read before a newer lease event must not drop that event's lease.
    setLease(prev => (prev && prev.epoch > next.lease.epoch ? prev : null))
    setError(null)
  }, [])

  const applyLease = useCallback((next: DisplayLease) => setLease(prev => (prev && isOlderLease(next, prev) ? prev : next)), [])

  const refresh = useCallback(async () => {
    const mine = ++ticket.current
    try {
      const next = await display.status(profile)
      if (mine === ticket.current) apply(next)
    } catch (e) {
      if (mine === ticket.current) setError(messageOf(e))
    }
  }, [profile, apply])

  useEffect(() => {
    ticket.current += 1
    profileKey.current = null
    setStatus(null)
    setLease(null)
    setError(null)
    setStarting(false)
    const client = connectGateway()
    const offEvents = client.onAny(raw => {
      const event = raw as unknown as EventShape
      const payload = event.payload
      if (!payload || !profileKey.current || payload.profile_key !== profileKey.current) return
      if (event.type === 'display.status') apply(payload as DisplayStatus)
      else if (event.type === 'display.lease' && payload.lease) applyLease(payload.lease)
    })
    // onState fires at once with the current state, so this covers the first read and every reconnect;
    // reading before the socket is open would only flash an error.
    const offState = client.onState(state => {
      if (state === 'open') void refresh()
    })
    return () => {
      offEvents()
      offState()
    }
  }, [profile, refresh, apply, applyLease])

  const start = useCallback(async () => {
    setStarting(true)
    setError(null)
    try {
      apply(await startScreen<DisplayStatus>(profile))
    } catch (e) {
      setError(messageOf(e))
    } finally {
      setStarting(false)
    }
  }, [profile, apply])

  const stop = useCallback(async () => {
    try {
      apply(await display.stop(profile))
    } catch (e) {
      setError(messageOf(e))
    }
  }, [profile, apply])

  return { view: deriveScreen(status, { lease, starting, error }, ourLeaseHash), refresh, applyLease, start, stop }
}
