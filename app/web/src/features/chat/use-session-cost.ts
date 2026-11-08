import { useEffect, useState } from 'react'

import { crewFetch } from '@/lib/crew-api'
import type { BotStatus } from '@/state/types'

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Estimated spend of a bot's chat session (USD), re-read on mount and whenever the bot starts or stops working
 * (so the figure is fresh once a turn finishes). */
export function useSessionCost(sessionId: string | null, profile: string, status: BotStatus): number | null {
  const [cost, setCost] = useState<number | null>(null)
  const working = status === 'working'

  useEffect(() => {
    if (!sessionId) return
    let active = true
    crewFetch(`/api/sessions/${encodeURIComponent(sessionId)}?profile=${encodeURIComponent(profile)}`)
      .then(res => (res.ok ? res.json() : null))
      .then((body: Record<string, unknown> | null) => {
        if (active) setCost(body ? (num(body.estimated_cost_usd) ?? num(body.actual_cost_usd)) : null)
      })
      .catch(() => {
        if (active) setCost(null)
      })
    return () => {
      active = false
    }
  }, [sessionId, profile, working])

  return sessionId ? cost : null
}
