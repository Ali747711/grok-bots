import { useState } from 'react'
import { toast } from 'sonner'

import { CrewApiError, updateBot } from './bots-api'
import { rebase } from './profile-form'
import type { BotDetail, BotPatch } from './types'

interface Pending {
  readonly patch: BotPatch
}
export interface Conflict extends Pending {
  readonly fields: readonly string[]
  readonly current: BotDetail
}
export interface Confirm extends Pending {
  readonly message: string
}

interface Deps {
  name: string
  /** Start over from this version of the bot (after a save, or taking their version). */
  onReset: (d: BotDetail) => void
  /** Re-read the bot to re-baseline after a failed save (a partial save may have written earlier sections). */
  reload: () => Promise<BotDetail | null>
}

export const failureText = (e: unknown): string =>
  e instanceof CrewApiError && e.status === 400 && e.body?.error === 'bad_body'
    ? "Some fields aren't filled in correctly."
    : e instanceof CrewApiError && e.status === 400 && e.body?.error === 'rejected' && typeof e.body.message === 'string'
    ? `Hermes refused it: ${e.body.message}`
    : e instanceof CrewApiError && e.status === 503
      ? 'Hermes is offline'
      : 'Could not save. Some changes may have been applied; the form was re-read, your edits are kept.'

/** Save a patch and keep the three non-success outcomes (conflict, confirm, failure) as state. */
export function useProfileSave({ name, onReset, reload }: Deps) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [confirm, setConfirm] = useState<Confirm | null>(null)

  const send = async (patch: BotPatch) => {
    setBusy(true)
    setError(null)
    try {
      const out = await updateBot(name, patch)
      if (out.status === 'saved') {
        onReset(out.detail)
        toast.success('Profile saved')
        setConflict(null)
        setConfirm(null)
      } else if (out.status === 'conflict') {
        setConflict({ patch, fields: out.fields, current: out.current })
      } else {
        setConfirm({ patch, message: out.message })
      }
    } catch (e) {
      setError(failureText(e))
      void reload()
    } finally {
      setBusy(false)
    }
  }

  return {
    busy, error, conflict, confirm, send,
    saveAnyway: () => conflict && void send(rebase(conflict.patch, conflict.current)),
    useConfirmed: () => confirm && void send({ ...confirm.patch, confirmExpensiveModel: true }),
    cancelConfirm: () => setConfirm(null),
    takeTheirs: () => {
      if (!conflict) return
      onReset(conflict.current)
      setConflict(null)
    }
  }
}
