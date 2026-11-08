import { useEffect, useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { deriveAvatarType } from '@/features/avatars/avatar-model'
import { AvatarPicker, type AvatarValue } from '@/features/avatars/AvatarPicker'

import { clearAvatar, setAvatar, updateBot } from './bots-api'
import type { AvatarChoice, BotDetail } from './types'

interface ProfileAvatarProps {
  detail: BotDetail
  /** A save finished; the detail is fresh. */
  onDetail: (detail: BotDetail) => void
  /** True while any avatar write (type, colour or photo) is in flight or being prepared. */
  onBusyChange: (busy: boolean) => void
  /** Unfinished setup: type and colour picks are held and reported (no save), then sent by Finish setup. */
  held?: boolean
  onHeld?: (choice: AvatarChoice) => void
  /** A form save is in flight: hold the picker so it cannot race it. */
  disabled?: boolean
}

const photoUrl = (detail: BotDetail) => (detail.look.imageKind === 'photo' ? `/crew/avatars/${encodeURIComponent(detail.name)}` : null)

/** The picker's value: the stored avatar, else the type the handle derives (and no colour). */
function valueOf(detail: BotDetail): AvatarValue {
  return { type: detail.avatar?.type ?? deriveAvatarType(detail.name), ...(detail.avatar?.color ? { color: detail.avatar.color } : {}), photo: photoUrl(detail) }
}

const choiceOf = (v: AvatarValue): AvatarChoice => ({ type: v.type, ...(v.color ? { color: v.color } : {}) })

/** Avatar editing: type, colour and photo save at once (one write at a time); an unfinished bot only holds its picks. */
export function ProfileAvatar({ detail, onDetail, onBusyChange, held = false, onHeld, disabled = false }: ProfileAvatarProps) {
  const [error, setError] = useState<string | null>(null)
  const [value, setValue] = useState<AvatarValue>(() => valueOf(detail))
  const [saving, setSaving] = useState(false)
  const [preparing, setPreparing] = useState(false)

  // Follow the saved bot; a held bot keeps its local type and colour (nothing is saved yet).
  useEffect(() => {
    setValue(prev => (held ? { ...prev, photo: photoUrl(detail) } : valueOf(detail)))
  }, [detail, held])
  useEffect(() => onBusyChange(saving || preparing), [saving, preparing, onBusyChange])

  const save = async (next: AvatarValue, photoChanged: boolean) => {
    setError(null)
    setSaving(true)
    try {
      if (photoChanged) {
        onDetail(next.photo ? await setAvatar(detail.name, next.photo) : await clearAvatar(detail.name))
        return
      }
      const out = await updateBot(detail.name, { avatar: choiceOf(next) })
      if (out.status === 'saved') onDetail(out.detail)
      else throw new Error('not saved')
    } catch {
      setValue(valueOf(detail))
      setError(photoChanged ? 'Could not change the photo. Try again.' : 'Could not change the avatar. Try again.')
    } finally {
      setSaving(false)
    }
  }

  const change = (next: AvatarValue) => {
    const photoChanged = (next.photo ?? null) !== (value.photo ?? null)
    setValue(next)
    if (held && !photoChanged) {
      onHeld?.(choiceOf(next))
      return
    }
    void save(next, photoChanged)
  }

  return (
    <>
      <AvatarPicker value={value} onChange={change} onBusyChange={setPreparing} disabled={disabled || saving} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </>
  )
}
