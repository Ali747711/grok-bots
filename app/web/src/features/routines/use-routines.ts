import { useCallback, useEffect, useState } from 'react'

import { listRoutines } from './routines-api'
import type { RoutineView } from './types'

const POLL_MS = 20_000

/** One bot's routines: loaded on mount and bot change, re-read every 20 s while mounted and after `reload()`. */
export function useRoutines(bot: string) {
  const [routines, setRoutines] = useState<RoutineView[] | null>(null)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    try {
      setRoutines(await listRoutines(bot))
      setError(false)
    } catch {
      setError(true)
    }
  }, [bot])

  useEffect(() => {
    setRoutines(null)
    void reload()
    const timer = setInterval(() => void reload(), POLL_MS)
    return () => clearInterval(timer)
  }, [reload])

  return { routines, error, reload }
}
