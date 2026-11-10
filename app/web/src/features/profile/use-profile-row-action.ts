import { useState } from 'react'

import { profileErrorText } from './profile-api'

interface Deps {
  /** The bot's title, for the sentences that name it. */
  title: string
  /** Re-reads what the row shows. It runs after every write, failed or not. */
  reload: () => Promise<unknown>
}

/**
 * One immediate-apply row of the profile (a switch or a choice): its own pending state, its own error
 * text, and a re-read after the write so the row shows what Hermes holds, not what was clicked.
 */
export function useProfileRowAction({ title, reload }: Deps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Runs one write. Resolves true when it was accepted. */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setPending(true)
    setError(null)
    let ok = true
    try {
      await action()
    } catch (e) {
      ok = false
      setError(profileErrorText(e, title))
    }
    try {
      // Also after a failure: a refused write may still have changed part of the config.
      await reload()
    } finally {
      setPending(false)
    }
    return ok
  }

  return { pending, error, run }
}
