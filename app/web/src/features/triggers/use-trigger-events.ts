import { useCallback, useEffect, useState } from 'react'

import { listTriggerEvents } from './triggers-api'
import type { TriggerEvent } from './types'

const FAST_MS = 5000
const SLOW_MS = 30_000

/** A trigger's event log: loaded when opened; re-read every 5 s while a run has started, else every 30 s. */
export function useTriggerEvents(triggerId: string, open: boolean) {
  const [events, setEvents] = useState<TriggerEvent[] | null>(null)
  const [error, setError] = useState(false)
  const running = events?.some(e => e.outcome === 'started') ?? false

  const load = useCallback(async () => {
    try {
      setEvents(await listTriggerEvents(triggerId))
      setError(false)
    } catch {
      setError(true)
    }
  }, [triggerId])

  useEffect(() => {
    if (!open) return
    setEvents(null)
    void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const timer = setInterval(() => void load(), running ? FAST_MS : SLOW_MS)
    return () => clearInterval(timer)
  }, [open, load, running])

  return { events, error }
}
