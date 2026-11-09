import type { DisplayLease, DisplayStatus } from '@/vendor/hermes/gateway-contract.generated'

export type ScreenKind = 'loading' | 'missing' | 'off' | 'low_memory' | 'starting' | 'live' | 'error'
export type ScreenControl = 'bot' | 'you' | 'someone'

export interface ScreenView {
  readonly kind: ScreenKind
  readonly control: ScreenControl
  /** The reason for `error`, `low_memory`; never set for a live screen (see `notice`). */
  readonly message?: string
  /** A failed refresh or refused Stop while the screen runs: the view stays `live` so it is not unmounted. */
  readonly notice: string | null
  /** The lease after applying any newer event; null until a status has loaded. */
  readonly lease: DisplayLease | null
  readonly status: DisplayStatus | null
}

/** What the hook learned besides the last `display.status`: a newer lease event, a start in flight, a failure. */
export interface ScreenEvents {
  readonly lease?: DisplayLease | null
  readonly starting?: boolean
  readonly error?: string | null
}

/** A lease event older than the one we already hold is stale (ported from Hermes `isOlderLease`). */
export const isOlderLease = (candidate: DisplayLease, current: DisplayLease): boolean => candidate.epoch < current.epoch

/** Our lease hash, or every hash that is ours (this viewer's and earlier ones of the same view). */
export type OurHashes = string | ReadonlySet<string> | null | undefined

function controlOf(lease: DisplayLease, ours: OurHashes): ScreenControl {
  if (lease.holder !== 'human') return 'bot'
  // "You" means the lease names a viewer whose hash is ours; any other human is someone else.
  const hash = lease.viewer_hash
  if (!hash || !ours) return 'someone'
  return (typeof ours === 'string' ? ours === hash : ours.has(hash)) ? 'you' : 'someone'
}

/**
 * The pane state for one bot, ported from Hermes's `portalTone` and pane render order (facts 8.1).
 * `loading` is no status yet; `starting` is the screen booting. `low_memory` is a stopped screen whose
 * `blocker` is set. An error replaces the view only when nothing is running: for a running screen it
 * is a `notice`, because the UI renders by kind and leaving `live` would unmount the viewer.
 */
export function deriveScreen(status: DisplayStatus | null, events: ScreenEvents, ourLeaseHash?: OurHashes): ScreenView {
  const error = events.error ?? null
  const base = { control: 'bot' as const, notice: null, lease: null, status }
  if (!status) return error ? { ...base, kind: 'error', message: error } : { ...base, kind: 'loading' }
  const lease = events.lease && !isOlderLease(events.lease, status.lease) ? events.lease : status.lease
  const stopped = { ...base, lease }
  if (!status.supported) return { ...stopped, kind: 'error', message: "This computer can't run a bot screen." }
  if (!status.installed) return { ...stopped, kind: 'missing' }
  if (status.running) return { ...stopped, kind: 'live', control: controlOf(lease, ourLeaseHash), notice: error }
  if (error) return { ...stopped, kind: 'error', message: error }
  if (events.starting) return { ...stopped, kind: 'starting' }
  if (status.blocker) return { ...stopped, kind: 'low_memory', message: status.blocker }
  return { ...stopped, kind: 'off' }
}
