import type { DisplayLease, DisplayStatus } from '@/vendor/hermes/gateway-contract.generated'

export type ScreenKind = 'missing' | 'off' | 'low_memory' | 'starting' | 'live' | 'error'
export type ScreenControl = 'bot' | 'you' | 'someone'

export interface ScreenView {
  readonly kind: ScreenKind
  readonly control: ScreenControl
  readonly message?: string
  readonly status: DisplayStatus | null
}

/** What the hook learned besides the last `display.status`: a newer lease event, a start in flight, a failure. */
export interface ScreenEvents {
  readonly lease?: DisplayLease | null
  readonly starting?: boolean
  readonly error?: string | null
}

/** A lease event older than the one we already hold is stale (ported from Hermes `isOlderLease`). */
const isOlder = (candidate: DisplayLease, current: DisplayLease): boolean => candidate.epoch < current.epoch

function controlOf(lease: DisplayLease, ourHash: string | null | undefined): ScreenControl {
  if (lease.holder !== 'human') return 'bot'
  // "You" means the lease names a viewer whose hash is ours; any other human is someone else.
  return ourHash && lease.viewer_hash === ourHash ? 'you' : 'someone'
}

/**
 * The pane state for one bot, ported from Hermes's `portalTone` and pane render order (facts 8.1). A
 * missing status means it is still loading, which looks like `starting`. `low_memory` is a stopped
 * screen whose `blocker` is set.
 */
export function deriveScreen(status: DisplayStatus | null, events: ScreenEvents, ourLeaseHash?: string | null): ScreenView {
  if (events.error) return { kind: 'error', control: 'bot', message: events.error, status }
  if (!status) return { kind: 'starting', control: 'bot', status }
  if (!status.supported) return { kind: 'error', control: 'bot', message: "This computer can't run a bot screen.", status }
  if (!status.installed) return { kind: 'missing', control: 'bot', status }
  if (!status.running) {
    if (events.starting) return { kind: 'starting', control: 'bot', status }
    if (status.blocker) return { kind: 'low_memory', control: 'bot', message: status.blocker, status }
    return { kind: 'off', control: 'bot', status }
  }
  const lease = events.lease && !isOlder(events.lease, status.lease) ? events.lease : status.lease
  return { kind: 'live', control: controlOf(lease, ourLeaseHash), status }
}
