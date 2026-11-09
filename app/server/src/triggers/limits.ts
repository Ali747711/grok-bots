export interface TriggerLimits {
  readonly perHour: number
  readonly concurrent: number
}

export const DEFAULT_LIMITS: TriggerLimits = { perHour: 10, concurrent: 2 }

export type Acquire = { ok: true } | { ok: false; reason: 'hourly' | 'concurrent'; detail: string }

export interface Limiter {
  tryAcquire(triggerId: string): Acquire
  /** `ran: false` means the run never started, so the hourly slot is given back too. */
  release(triggerId: string, ran: boolean): void
  /** Restore state after a restart: start times of recent runs and the number still in flight. */
  seed(triggerId: string, startedAt: readonly number[], inFlight: number): void
}

const HOUR_MS = 3_600_000

interface Slot {
  stamps: number[]
  inFlight: number
}

export function createLimiter(limits: TriggerLimits, now: () => number): Limiter {
  const slots = new Map<string, Slot>()
  const slot = (id: string): Slot => {
    let s = slots.get(id)
    if (!s) slots.set(id, (s = { stamps: [], inFlight: 0 }))
    return s
  }
  return {
    tryAcquire(id) {
      const s = slot(id)
      const t = now()
      s.stamps = s.stamps.filter(at => t - at <= HOUR_MS)
      if (s.stamps.length >= limits.perHour) return { ok: false, reason: 'hourly', detail: `${limits.perHour} runs in the last hour` }
      if (s.inFlight >= limits.concurrent) return { ok: false, reason: 'concurrent', detail: `${limits.concurrent} runs already running` }
      s.stamps.push(t)
      s.inFlight++
      return { ok: true }
    },
    release(id, ran) {
      const s = slot(id)
      s.inFlight = Math.max(0, s.inFlight - 1)
      if (!ran) s.stamps.pop()
    },
    seed(id, startedAt, inFlight) {
      const s = slot(id)
      s.stamps = [...startedAt].sort((a, b) => a - b)
      s.inFlight = inFlight
    }
  }
}
