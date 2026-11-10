import { type SandboxState, sandboxStateOf } from './sandbox-state.js'

export interface SandboxRoster {
  /** Never rejects: a bot whose read failed keeps its last state, or is left out. */
  states(names: readonly string[]): Promise<ReadonlyMap<string, SandboxState>>
  /** Crew's own writes call this so the next roster sync re-reads that bot. */
  invalidate(name: string): void
}

interface Entry { readonly state: SandboxState; readonly at: number }

/** Roster sandbox state per bot, cached for `ttlMs` (R9). Hand edits show within a minute. */
export function createSandboxRoster(
  read: (name: string) => Promise<unknown>,
  now: () => number,
  ttlMs = 60_000
): SandboxRoster {
  const cache = new Map<string, Entry>()
  // Names invalidated since their last read; kept apart so the last state survives a failed re-read.
  const stale = new Set<string>()
  const fresh = (name: string, at: number): boolean => {
    const entry = cache.get(name)
    return !!entry && !stale.has(name) && at - entry.at < ttlMs
  }
  const refresh = async (name: string): Promise<void> => {
    try {
      const raw = await read(name)
      const config = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
      cache.set(name, { state: sandboxStateOf(config).state, at: now() })
      stale.delete(name)
    } catch {
      // Keep the last known value; a missing name simply stays out of the map.
    }
  }
  return {
    async states(names) {
      const at = now()
      await Promise.all(names.filter(name => !fresh(name, at)).map(refresh))
      const out = new Map<string, SandboxState>()
      for (const name of names) {
        const entry = cache.get(name)
        if (entry) out.set(name, entry.state)
      }
      return out
    },
    invalidate(name) {
      stale.add(name)
    }
  }
}
