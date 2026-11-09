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

export const HIDDEN_DETACH_MS = 5 * 60_000
export const SECURITY_RETRY_MS = 12_000
export const MAX_SECURITY_STRIKES = 2
export const NO_SECURE_CONTEXT = 'The screen needs a secure connection (https or localhost).'
export const BUDGET_SPENT = "Couldn't reconnect to the screen. Try again."
export const SECURITY_REFUSED = 'The screen refused the connection. Try again.'


/** Named one-shot timers: setting a name replaces its pending timer. */
export class Timers {
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()

  set(name: string, fn: () => void, ms: number): void {
    this.clear(name)
    this.pending.set(name, setTimeout(() => {
      this.pending.delete(name)
      fn()
    }, ms))
  }

  has(name: string): boolean {
    return this.pending.has(name)
  }

  clear(name: string): void {
    const timer = this.pending.get(name)
    if (timer) clearTimeout(timer)
    this.pending.delete(name)
  }
}
