import { useCallback, useEffect, useState } from 'react'

import { getBot } from './bots-api'
import type { BotDetail } from './types'

/** Loads one bot's editable detail. `setDetail` takes a fresher copy from a save; `reload` re-reads it from Hermes. */
export function useBotDetail(name: string) {
  const [detail, setDetail] = useState<BotDetail | null>(null)
  const [error, setError] = useState(false)

  const reload = useCallback(async (): Promise<BotDetail | null> => {
    try {
      const next = await getBot(name)
      setDetail(next)
      setError(false)
      return next
    } catch {
      setError(true)
      return null
    }
  }, [name])

  useEffect(() => {
    void reload()
  }, [reload])

  return { detail, error, reload, setDetail }
}
