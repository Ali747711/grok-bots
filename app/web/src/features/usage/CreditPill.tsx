import { useEffect, useState } from 'react'

import { crewFetch } from '@/lib/crew-api'

export interface Usage {
  state: 'ok' | 'stale' | 'unavailable'
  remaining: number | null
}

const REFRESH_MS = 60_000

async function loadUsage(): Promise<Usage | null> {
  try {
    const res = await crewFetch('/crew/usage')
    if (!res.ok) return null
    const body = (await res.json()) as Partial<Usage>
    return { state: body.state ?? 'unavailable', remaining: typeof body.remaining === 'number' ? body.remaining : null }
  } catch {
    return null
  }
}

/** OpenRouter credit, refreshed every minute; null until the first answer or when the call fails. */
export function useUsage(): Usage | null {
  const [usage, setUsage] = useState<Usage | null>(null)

  useEffect(() => {
    let active = true
    const refresh = () => {
      void loadUsage().then(next => {
        if (active) setUsage(next)
      })
    }
    refresh()
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [])
  return usage
}

/** The credit left as short text: "$1.82 credit left" or "credit unknown". */
export function creditText(usage: Usage | null): string {
  const remaining = usage !== null && usage.state !== 'unavailable' ? usage.remaining : null
  return remaining !== null ? `$${remaining.toFixed(2)} credit left` : 'credit unknown'
}

/** The pill for an already-loaded usage value (the sidebar polls once and shares it). */
export function CreditPillView({ usage }: { usage: Usage | null }) {
  const remaining = usage !== null && usage.state !== 'unavailable' ? usage.remaining : null
  return (
    <div data-testid="credit-pill" className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
      <span>{creditText(usage)}</span>
      {remaining !== null && usage?.state === 'stale' && <span className="ml-1 opacity-70">(stale)</span>}
    </div>
  )
}

/** OpenRouter credit left; "credit unknown" when the server has no good value. */
export function CreditPill() {
  return <CreditPillView usage={useUsage()} />
}
