import { useCallback, useEffect, useRef, useState } from 'react'

import { connectGateway } from '@/chat/gateway'
import { startScreen } from '@/lib/crew-api'
import type { DisplayLease, DisplayStatus } from '@/vendor/hermes/gateway-contract.generated'

import * as display from './display-client'
import { type OurHashes, type ScreenView, deriveScreen, isOlderLease } from './screen-state'

export interface UseScreen {
  readonly view: ScreenView
  /** Re-read the status; resolves with it, or null when the read failed or a newer one superseded it. */
  readonly refresh: () => Promise<DisplayStatus | null>
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

interface ScreenData {
  readonly status: DisplayStatus | null
  readonly lease: DisplayLease | null
  readonly starting: boolean
  readonly error: string | null
  readonly setStarting: (on: boolean) => void
  readonly setError: (message: string | null) => void
  readonly apply: (next: DisplayStatus) => void
  readonly applyLease: (next: DisplayLease) => void
  readonly refresh: () => Promise<DisplayStatus | null>
  /** Forget everything: a new profile starts from nothing. */
  readonly reset: () => void
  /** The `profile_key` the events are filtered by; null until the first status. */
  readonly profileKey: () => string | null
}

/** The status, the newest lease and the failure of one bot, with tickets so a stale reply is dropped. */
function useScreenData(profile: string): ScreenData {
  const [status, setStatus] = useState<DisplayStatus | null>(null)
  const [lease, setLease] = useState<DisplayLease | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Each read or event takes a ticket; a reply holding an older ticket is dropped.
  const ticket = useRef(0)
  const key = useRef<string | null>(null)

  const apply = useCallback((next: DisplayStatus) => {
    ticket.current += 1
    key.current = next.profile_key
    setStatus(next)
    // A status read before a newer lease event must not drop that event's lease.
    setLease(prev => (prev && prev.epoch > next.lease.epoch ? prev : null))
    setError(null)
  }, [])
  const applyLease = useCallback((next: DisplayLease) => setLease(prev => (prev && isOlderLease(next, prev) ? prev : next)), [])
  const reset = useCallback(() => {
    ticket.current += 1
    key.current = null
    setStatus(null)
    setLease(null)
    setError(null)
    setStarting(false)
  }, [])
  const profileKey = useCallback(() => key.current, [])
  const refresh = useCallback(async () => {
    const mine = ++ticket.current
    try {
      const next = await display.status(profile)
      if (mine !== ticket.current) return null
      apply(next)
      return next
    } catch (e) {
      if (mine === ticket.current) setError(messageOf(e))
      return null
    }
  }, [profile, apply])

  return { status, lease, starting, error, setStarting, setError, apply, applyLease, refresh, reset, profileKey }
}

/** Events are broadcast for every bot, so they are filtered by `profile_key`; every (re)open re-reads the status. */
function useScreenSubscription(profile: string, data: ScreenData): void {
  const { apply, applyLease, refresh, reset, profileKey } = data
  useEffect(() => {
    reset()
    const client = connectGateway()
    const offEvents = client.onAny(raw => {
      const event = raw as unknown as EventShape
      const payload = event.payload
      const key = profileKey()
      if (!payload || !key || payload.profile_key !== key) return
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
  }, [profile, refresh, apply, applyLease, reset, profileKey])
}

/** Start through the server route (it sets the idle stop first) and stop through the gateway. */
function useScreenActions(profile: string, data: ScreenData): { start: () => Promise<void>; stop: () => Promise<void> } {
  const { apply, setError, setStarting } = data
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
  }, [profile, apply, setError, setStarting])
  const stop = useCallback(async () => {
    try {
      apply(await display.stop(profile))
    } catch (e) {
      setError(messageOf(e))
    }
  }, [profile, apply, setError])
  return { start, stop }
}

/**
 * The screen state of one bot: `display.status {profile}` plus the `display.*` events, re-read after
 * a gateway reconnect, since events missed while down are not replayed (facts 1.3).
 */
export function useScreen(profile: string, ourLeaseHash?: OurHashes): UseScreen {
  const data = useScreenData(profile)
  useScreenSubscription(profile, data)
  const { start, stop } = useScreenActions(profile, data)
  const { status, lease, starting, error, refresh, applyLease } = data
  return { view: deriveScreen(status, { lease, starting, error }, ourLeaseHash), refresh, applyLease, start, stop }
}
