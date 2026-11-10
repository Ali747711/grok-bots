import { useCallback, useEffect, useState } from 'react'

import { listTriggers } from './triggers-api'
import type { TriggerView } from './types'

const POLL_MS = 20_000

/** One bot's triggers: loaded on mount and bot change, re-read every 20 s while mounted and after `reload()`. */
export function useTriggers(bot: string) {
  const [triggers, setTriggers] = useState<TriggerView[] | null>(null)
  /** The last list failure (a CrewApiError carries the server's reason), or null. */
  const [error, setError] = useState<unknown>(null)

  const reload = useCallback(async () => {
    try {
      setTriggers(await listTriggers(bot))
      setError(null)
    } catch (e) {
      setError(e ?? new Error('list failed'))
    }
  }, [bot])

  useEffect(() => {
    setTriggers(null)
    void reload()
    const timer = setInterval(() => void reload(), POLL_MS)
    return () => clearInterval(timer)
  }, [reload])

  return { triggers, error, reload }
}
