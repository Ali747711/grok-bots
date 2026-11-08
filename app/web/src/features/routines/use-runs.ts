import { useCallback, useEffect, useState } from 'react'

import { listRuns } from './routines-api'
import type { RunView } from './types'

const FAST_MS = 5_000
const SLOW_MS = 30_000

/**
 * A routine's last runs: loaded on mount, re-read every 5 s while any run is running and every 30 s otherwise,
 * and again whenever `refreshKey` changes (a Run now just started).
 */
export function useRuns(bot: string, routineId: string, refreshKey = 0) {
  const [runs, setRuns] = useState<RunView[] | null>(null)
  const [error, setError] = useState(false)

  const reload = useCallback(async () => {
    try {
      setRuns(await listRuns(bot, routineId))
      setError(false)
    } catch {
      setError(true)
    }
  }, [bot, routineId])

  const anyRunning = runs?.some(r => r.status === 'running') ?? false
  useEffect(() => {
    void reload()
  }, [reload, refreshKey])
  // Switching between the fast and slow pace must not trigger an extra read.
  useEffect(() => {
    const timer = setInterval(() => void reload(), anyRunning ? FAST_MS : SLOW_MS)
    return () => clearInterval(timer)
  }, [reload, anyRunning])

  return { runs, error }
}
