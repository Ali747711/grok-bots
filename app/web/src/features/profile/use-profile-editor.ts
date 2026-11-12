import { useState } from 'react'

import { deriveAvatarType } from '@/features/avatars/avatar-model'
import { finishBot } from '@/features/bots/bots-api'
import { type ProfileForm, buildPatch, freshSync, hasChanges, mergeFresh } from '@/features/bots/profile-form'
import type { AvatarChoice, BotDetail } from '@/features/bots/types'
import { useProfileSave } from '@/features/bots/use-profile-save'

import { useProfileDraft } from './profile-drafts'

interface Deps {
  name: string
  detail: BotDetail
  setDetail: (detail: BotDetail) => void
  reload: () => Promise<BotDetail | null>
}

/**
 * The profile's text form and everything that saves it: the kept draft, the patch against its start
 * values, the saver (conflict, costly-model confirm, failure) and Finish setup. Refreshes keep edits
 * and their original baselines.
 */
export function useProfileEditor({ name, detail, setDetail, reload }: Deps) {
  const [sync, setSync] = useProfileDraft(name, detail)
  // True while an avatar write is in flight or being prepared: Save waits, so the two cannot race.
  const [avatarBusy, setAvatarBusy] = useState(false)
  // An unfinished bot's avatar pick, held until Finish setup sends it.
  const [held, setHeld] = useState<AvatarChoice | null>(null)

  const refreshed = (d: BotDetail) => {
    setDetail(d)
    setSync(s => mergeFresh(s, d))
  }
  const reset = (d: BotDetail) => {
    setDetail(d)
    setSync(freshSync(d))
  }
  const reloadMerged = async () => {
    const d = await reload()
    if (d) setSync(s => mergeFresh(s, d))
    return d
  }
  const edit = (change: Partial<ProfileForm>) => setSync(s => ({ ...s, form: { ...s.form, ...change } }))

  const saver = useProfileSave({ name, onReset: reset, reload: reloadMerged })
  const patch = buildPatch(sync.form, sync.loaded)
  const dirty = hasChanges(patch)
  const busy = saver.busy || avatarBusy

  /** Resolves with the problem when a step still fails, else null. */
  const finish = async (): Promise<string | null> => {
    // The picker's current value: the stored avatar, else the derived type with no colour.
    const avatar = held ?? detail.avatar ?? { type: deriveAvatarType(name) }
    const result = await finishBot(name, { title: sync.form.name.trim(), avatar })
    if (result.complete) setHeld(null)
    await reloadMerged()
    return result.complete ? null : (result.error?.message ?? 'a step failed')
  }

  return {
    form: sync.form, edit, refreshed, reloadMerged, saver, dirty, busy, finish,
    avatar: { held, setHeld, setBusy: setAvatarBusy },
    save: () => {
      if (dirty && !busy) void saver.send(patch)
    },
    /** Back to what is saved: their version when a conflict is open, else the bot as last read. */
    discard: () => {
      reset(saver.conflict?.current ?? detail)
      saver.dismiss()
    }
  }
}
