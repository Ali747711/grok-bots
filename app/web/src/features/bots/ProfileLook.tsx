import { useState } from 'react'

import { clearAvatar, setAvatar } from './bots-api'
import { LookPicker, type LookValue, type PickerLook } from './LookPicker'
import type { BotDetail } from './types'

interface ProfileLookProps {
  detail: BotDetail
  look: PickerLook
  onLook: (look: PickerLook) => void
  /** A photo upload or removal finished; the detail is fresh. */
  onDetail: (detail: BotDetail) => void
  onBusyChange: (busy: boolean) => void
  initial: string
}

/** Look editing: shape and colour are saved with the form, a photo is saved at once. */
export function ProfileLook({ detail, look, onLook, onDetail, onBusyChange, initial }: ProfileLookProps) {
  const [photo, setPhoto] = useState<string | undefined>(detail.look.imageKind === 'photo' ? `/crew/avatars/${encodeURIComponent(detail.name)}` : undefined)
  const [error, setError] = useState<string | null>(null)

  const change = async (next: LookValue) => {
    if (next.image === photo) {
      onLook(next.look)
      return
    }
    setError(null)
    onBusyChange(true)
    try {
      onDetail(next.image ? await setAvatar(detail.name, next.image) : await clearAvatar(detail.name))
      setPhoto(next.image)
    } catch {
      setError('Could not change the photo. Try again.')
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <>
      <LookPicker value={{ look, ...(photo ? { image: photo } : {}) }} onChange={v => void change(v)} initial={initial} onBusyChange={onBusyChange} />
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </>
  )
}
