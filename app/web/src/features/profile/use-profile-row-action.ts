import { useState } from 'react'

import { profileErrorText } from './profile-api'

/** Said on a row whose write was accepted but could not be read back. */
export const UNCONFIRMED = "Saved, but Crew couldn't re-check it. Reload to confirm."

interface Deps {
  /** The bot's title, for the sentences that name it. */
  title: string
  /** Re-reads what the row shows, after every write, failed or not. Resolves false when the re-read failed. */
  reload: () => Promise<boolean>
}

/**
 * One immediate-apply row of the profile (a switch or a choice): its own pending state, its own error
 * text, and a re-read after the write so the row shows what Hermes holds, not what was clicked.
 * The action itself shows what its write answered; when the re-read then fails, that value stays and
 * `notice` says Crew could not confirm it.
 */
export function useProfileRowAction({ title, reload }: Deps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  /** Runs one write. Resolves true when it was accepted. */
  const run = async (action: () => Promise<unknown>): Promise<boolean> => {
    setPending(true)
    setError(null)
    setNotice(null)
    let ok = true
    try {
      await action()
    } catch (e) {
      ok = false
      setError(profileErrorText(e, { title }))
    }
    try {
      // Also after a failure: a refused write may still have changed part of the config.
      const confirmed = await reload().catch(() => false)
      if (ok && !confirmed) setNotice(UNCONFIRMED)
    } finally {
      setPending(false)
    }
    return ok
  }

  return { pending, error, notice, run }
}
