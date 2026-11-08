import type { DisplayLease } from '@/vendor/hermes/gateway-contract.generated'

export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

export const heldBy = (lease: DisplayLease | null | undefined, hash: string): boolean => lease?.holder === 'human' && lease.viewer_hash === hash

export async function viewerHash(id: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('').slice(0, 12)
}

export function displayUrl(ticket: string): string {
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/display/ws?display_ticket=${encodeURIComponent(ticket)}`
}

export type ConnectFailure = 'not_running' | 'transport' | 'other'

/**
 * JSON-RPC errors carry a numeric `code`; a gateway that is not open, a timeout or a dropped socket
 * does not. Hermes answers 5300 "not running" when the screen went away between status and observe.
 */
export function classifyConnectError(error: unknown): ConnectFailure {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code !== 'number') return 'transport'
  return code === 5300 && /not running/i.test(messageOf(error)) ? 'not_running' : 'other'
}
