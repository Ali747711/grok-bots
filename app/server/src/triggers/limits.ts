export interface TriggerLimits {
  readonly perHour: number
  readonly concurrent: number
}

export const DEFAULT_LIMITS: TriggerLimits = { perHour: 10, concurrent: 2 }

/** A held slot. `release` works once; later calls do nothing. */
export interface Held {
  /** `ran: false` means the run never started, so its own hourly stamp is given back too. */
  release(ran: boolean): void
}

export type Acquire = ({ ok: true } & Held) | { ok: false; reason: 'hourly' | 'concurrent'; detail: string }

export interface Limiter {
  tryAcquire(triggerId: string, nowMs: number): Acquire
  /** Restart recovery: a run already in flight that started at `startedAtMs`; counts toward both caps. */
  adopt(triggerId: string, startedAtMs: number): Held
}

const HOUR_MS = 3_600_000

interface Stamp {
  readonly at: number
}
interface Slot {
  stamps: Stamp[]
  inFlight: number
}

export function createLimiter(limits: TriggerLimits): Limiter {
  const slots = new Map<string, Slot>()
  const slot = (id: string): Slot => {
    let s = slots.get(id)
    if (!s) slots.set(id, (s = { stamps: [], inFlight: 0 }))
    return s
  }
  // The handle owns its stamp, so a release can only undo its own run (never a newer or finished one).
  const hold = (s: Slot, stamp: Stamp): Held => {
    let released = false
    return {
      release(ran) {
        if (released) return
        released = true
        s.inFlight = Math.max(0, s.inFlight - 1)
        if (!ran) s.stamps = s.stamps.filter(x => x !== stamp)
      }
    }
  }
  return {
    tryAcquire(id, nowMs) {
      const s = slot(id)
      s.stamps = s.stamps.filter(x => nowMs - x.at <= HOUR_MS)
      if (s.stamps.length >= limits.perHour) return { ok: false, reason: 'hourly', detail: `${limits.perHour} runs in the last hour` }
      if (s.inFlight >= limits.concurrent) return { ok: false, reason: 'concurrent', detail: `${limits.concurrent} runs already running` }
      const stamp = { at: nowMs }
      s.stamps.push(stamp)
      s.inFlight++
      return { ok: true, ...hold(s, stamp) }
    },
    adopt(id, startedAtMs) {
      const s = slot(id)
      const stamp = { at: startedAtMs }
      s.stamps.push(stamp)
      s.inFlight++
      return hold(s, stamp)
    }
  }
}
