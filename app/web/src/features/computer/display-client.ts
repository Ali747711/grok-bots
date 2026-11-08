import { connectGateway } from '@/chat/gateway'
import type { DisplayLeaseResult, DisplayObserveResult, DisplayStatus, DisplayStopResult, DisplayThumbnailResult } from '@/vendor/hermes/gateway-contract.generated'

const THUMBNAIL_TIMEOUT_MS = 5000

/**
 * Every `display.*` call carries the bot's profile: Hermes answers a call without one for the
 * `default` bot (facts 1.1), and Crew's server refuses it anyway. `display.start` is deliberately
 * absent: screens start through `POST /crew/bots/:name/screen/start`, which sets the idle stop first.
 */
function call<T>(method: string, profile: string, extra: Record<string, unknown> = {}, timeoutMs?: number): Promise<T> {
  if (typeof profile !== 'string' || !profile.trim()) return Promise.reject(new Error(`${method} needs a profile`))
  return connectGateway().request<T>(method, { profile, ...extra }, timeoutMs)
}

export const status = (profile: string): Promise<DisplayStatus> => call('display.status', profile)

export const observe = (profile: string, viewerId?: string): Promise<DisplayObserveResult> =>
  call('display.observe', profile, viewerId ? { viewer_id: viewerId } : {})

export const acquire = (profile: string, viewerId: string): Promise<DisplayLeaseResult> =>
  call('display.lease.acquire', profile, { viewer_id: viewerId })

export const release = (profile: string, target: string | { force: true }): Promise<DisplayLeaseResult> =>
  call('display.lease.release', profile, typeof target === 'string' ? { viewer_id: target } : { force: true })

export const thumbnail = (profile: string): Promise<DisplayThumbnailResult> => call('display.thumbnail', profile, {}, THUMBNAIL_TIMEOUT_MS)

export const stop = (profile: string): Promise<DisplayStopResult> => call('display.stop', profile)

/** noVNC is large: load it only when a live view mounts. */
export const loadRfb = async () => (await import('@novnc/novnc')).default
