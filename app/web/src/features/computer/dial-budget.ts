export interface DialBudgetOptions {
  readonly max: number
  readonly windowMs: number
  readonly mountDelayMs: number
  readonly now?: () => number
}

export type DialDecision =
  | { allowed: true }
  | { allowed: false; reason: 'mounting'; retryInMs: number }
  | { allowed: false; reason: 'exhausted' }

export interface DialBudget {
  /** The live view for `bot` just mounted: Xvnc locks everyone out after a few aborted dials (§11 R4). */
  markMounted(bot: string): void
  /** Ask to dial; an allowed answer is counted. A refused one is not. */
  request(bot: string): DialDecision
  reset(bot: string): void
  /**
   * Give back the latest dial. Only for a stream that reached RFB `connect` and was then detached on
   * purpose (a panel/Expand move, a hidden-tab suspend); never after a server-initiated close, so the
   * loop protection of §11 R4 stays.
   */
  refund(bot: string): void
}

/** At most `max` dials per bot per `windowMs`, and none until the view has been mounted for `mountDelayMs`. */
export function createDialBudget(options: DialBudgetOptions): DialBudget {
  const now = options.now ?? Date.now
  const mounted = new Map<string, number>()
  const dials = new Map<string, readonly number[]>()
  return {
    markMounted: bot => void mounted.set(bot, now()),
    reset: bot => void dials.delete(bot),
    refund: bot => void dials.set(bot, (dials.get(bot) ?? []).slice(0, -1)),
    request: bot => {
      const at = now()
      const waited = at - (mounted.get(bot) ?? at)
      if (waited < options.mountDelayMs) return { allowed: false, reason: 'mounting', retryInMs: options.mountDelayMs - waited }
      const recent = (dials.get(bot) ?? []).filter(t => at - t < options.windowMs)
      if (recent.length >= options.max) {
        dials.set(bot, recent)
        return { allowed: false, reason: 'exhausted' }
      }
      dials.set(bot, [...recent, at])
      return { allowed: true }
    }
  }
}

/**
 * One budget per page, shared by every bot's view. Task 5's live view must use this instance for the
 * first dial and every redial. `request` before `markMounted` always answers `mounting`.
 */
export const pageDialBudget: DialBudget = createDialBudget({ max: 3, windowMs: 10_000, mountDelayMs: 300 })
