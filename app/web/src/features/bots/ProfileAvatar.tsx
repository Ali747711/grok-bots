import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { deriveAvatarType } from '@/features/avatars/avatar-model'
import { AvatarPicker, type AvatarValue } from '@/features/avatars/AvatarPicker'

import { clearAvatar, setAvatar, updateBot } from './bots-api'
import type { BotDetail } from './types'

interface ProfileAvatarProps {
  detail: BotDetail
  /** A save finished; the detail is fresh. */
  onDetail: (detail: BotDetail) => void
  onBusyChange: (busy: boolean) => void
}

const photoUrl = (detail: BotDetail) => (detail.look.imageKind === 'photo' ? `/crew/avatars/${encodeURIComponent(detail.name)}` : null)

/** The picker's value: the stored avatar, else the type the handle derives (and no colour). */
function valueOf(detail: BotDetail): AvatarValue {
  return { type: detail.avatar?.type ?? deriveAvatarType(detail.name), ...(detail.avatar?.color ? { color: detail.avatar.color } : {}), photo: photoUrl(detail) }
}

/** Avatar editing: every change (type, colour, photo) is saved at once, like hide and delete. */
export function ProfileAvatar({ detail, onDetail, onBusyChange }: ProfileAvatarProps) {
  const [error, setError] = useState<string | null>(null)
  const value = valueOf(detail)

  const change = async (next: AvatarValue) => {
    setError(null)
    onBusyChange(true)
    try {
      if ((next.photo ?? null) !== value.photo) {
        onDetail(next.photo ? await setAvatar(detail.name, next.photo) : await clearAvatar(detail.name))
      } else {
        const out = await updateBot(detail.name, { avatar: { type: next.type, ...(next.color ? { color: next.color } : {}) } })
        if (out.status === 'saved') onDetail(out.detail)
        else setError('Could not change the avatar. Try again.')
      }
    } catch {
      setError('Could not change the avatar. Try again.')
    } finally {
      onBusyChange(false)
    }
  }

  return (
    <>
      <AvatarPicker value={value} onChange={v => void change(v)} onBusyChange={onBusyChange} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </>
  )
}
