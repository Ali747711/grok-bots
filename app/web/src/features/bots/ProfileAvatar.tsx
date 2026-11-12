import { useEffect, useRef, useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { avatarWear, deriveAvatarType } from '@/features/avatars/avatar-model'
import { AvatarPicker, type AvatarValue } from '@/features/avatars/AvatarPicker'
import { AccessoryPicker } from '@/features/profile/AccessoryPicker'
import { RowError, RowNotice } from '@/features/profile/RowNotes'
import { useProfileRowAction } from '@/features/profile/use-profile-row-action'

import { clearAvatar, setAvatar, updateBot } from './bots-api'
import type { AvatarChoice, BotDetail } from './types'

interface ProfileAvatarProps {
  detail: BotDetail
  /** A save finished; the detail is fresh. */
  onDetail: (detail: BotDetail) => void
  /** True while any avatar write (type, colour or photo) is in flight or being prepared. */
  onBusyChange: (busy: boolean) => void
  /** Re-reads the bot after an accessory write, so the picker shows what Hermes holds; null when it could not be read. */
  reload: () => Promise<BotDetail | null>
  /** Unfinished setup: type, colour and accessory picks are held and reported (no save), then sent by Finish setup. */
  held?: boolean
  /** The held (unsent) pick, or null once it was sent or dropped. */
  heldChoice?: AvatarChoice | null
  onHeld?: (choice: AvatarChoice | null) => void
  /** A form save is in flight: hold the picker so it cannot race it. */
  disabled?: boolean
}

const PREVIEW_SIZE = 120
const PHOTO_REASON = 'Accessories show on shape avatars.'

const photoUrl = (detail: BotDetail) => (detail.look.imageKind === 'photo' ? `/crew/avatars/${encodeURIComponent(detail.name)}` : null)

/** The picker's value: the stored avatar with what it wears, else the type the handle derives (and no colour). */
function valueOf(detail: BotDetail): AvatarValue {
  return { ...avatarWear(detail.avatar), type: detail.avatar?.type ?? deriveAvatarType(detail.name), ...(detail.avatar?.color ? { color: detail.avatar.color } : {}), photo: photoUrl(detail) }
}

/** The avatar as the routes take it: the value without its photo. */
const choiceOf = (v: AvatarValue): AvatarChoice => ({ type: v.type, ...(v.color ? { color: v.color } : {}), ...avatarWear(v) })

interface SaveDeps {
  /** The latest bot, read when an async save finishes. */
  latest: { readonly current: BotDetail }
  onDetail: (detail: BotDetail) => void
  /** A save failed: put the picker back on what is really stored. */
  onFail: () => void
}

/** One avatar write at a time: a photo goes to the avatar route, a type or colour to PATCH. (Accessories are a profile row of their own.) */
function useAvatarSave({ latest, onDetail, onFail }: SaveDeps) {
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const save = async (next: AvatarValue, photoChanged: boolean) => {
    setError(null)
    setSaving(true)
    const name = latest.current.name
    try {
      if (photoChanged) {
        onDetail(next.photo ? await setAvatar(name, next.photo) : await clearAvatar(name))
        return
      }
      const out = await updateBot(name, { avatar: choiceOf(next) })
      if (out.status === 'saved') onDetail(out.detail)
      else throw new Error('not saved')
    } catch {
      onFail()
      setError(photoChanged ? 'Could not change the photo. Try again.' : 'Could not change the avatar. Try again.')
    } finally {
      setSaving(false)
    }
  }
  return { saving, error, save }
}

interface HeldDeps {
  held: boolean
  heldChoice: AvatarChoice | null
  onHeld?: (choice: AvatarChoice | null) => void
  latest: { readonly current: BotDetail }
  saving: boolean
  save: (next: AvatarValue, photoChanged: boolean) => Promise<void>
  setValue: (next: AvatarValue) => void
}

/**
 * Another save can end setup before Finish; a held pick must not be lost, so send it once, but only when no other
 * save is in flight (the picker stays locked until then). Returns true while the pick is waiting.
 */
function useHeldAvatar({ held, heldChoice, onHeld, latest, saving, save, setValue }: HeldDeps): boolean {
  const wasHeld = useRef(held)
  const [queued, setQueued] = useState<AvatarValue | null>(null)
  useEffect(() => {
    const ended = wasHeld.current && !held
    wasHeld.current = held
    if (!ended || !heldChoice || latest.current.avatar) return
    const next = { ...heldChoice, photo: photoUrl(latest.current) }
    onHeld?.(null)
    setValue(next)
    setQueued(next)
  }, [held])
  useEffect(() => {
    if (!queued || saving) return
    setQueued(null)
    void save(queued, false)
  }, [queued, saving])
  return queued !== null
}

/**
 * Avatar editing: type, colour, photo and accessories save at once (one write at a time); an unfinished
 * bot only holds its picks. Accessories belong to shape avatars, so a photo holds them with the reason.
 */
export function ProfileAvatar({ detail, onDetail, onBusyChange, reload, held = false, heldChoice = null, onHeld, disabled = false }: ProfileAvatarProps) {
  const [value, setValue] = useState<AvatarValue>(() => valueOf(detail))
  const [preparing, setPreparing] = useState(false)
  // The latest bot and held flag, for async callbacks that outlive the render that started them.
  const latest = useRef(detail)
  latest.current = detail
  const heldNow = useRef(held)
  heldNow.current = held
  // A failed save restores the stored avatar; a held bot only loses the photo, keeping its held pick.
  const onFail = () => setValue(prev => (heldNow.current ? { ...prev, photo: photoUrl(latest.current) } : valueOf(latest.current)))
  const { saving, error, save } = useAvatarSave({ latest, onDetail, onFail })
  const wear = useProfileRowAction({ title: detail.title, reload: async () => (await reload()) !== null })
  const waiting = useHeldAvatar({ held, heldChoice, onHeld, latest, saving, save, setValue })
  const locked = disabled || saving || preparing || waiting || wear.pending

  // Follow the saved bot; a held bot keeps its local picks (nothing is saved yet).
  useEffect(() => {
    setValue(prev => (held ? { ...prev, photo: photoUrl(detail) } : valueOf(detail)))
  }, [detail, held])
  useEffect(() => onBusyChange(saving || preparing || waiting || wear.pending), [saving, preparing, waiting, wear.pending, onBusyChange])

  const change = (next: AvatarValue) => {
    const photoChanged = (next.photo ?? null) !== (value.photo ?? null)
    setValue(next)
    if (held && !photoChanged) {
      onHeld?.(choiceOf(next))
      return
    }
    void save(next, photoChanged)
  }
  const changeWear = async (next: AvatarChoice) => {
    setValue({ ...next, photo: value.photo ?? null })
    if (held) {
      onHeld?.(next)
      return
    }
    const saved = await wear.run(async () => {
      const out = await updateBot(latest.current.name, { avatar: next })
      // A lone avatar is not a guarded field, so anything but "saved" is a failure.
      if (out.status !== 'saved') throw new Error('not saved')
      onDetail(out.detail)
    })
    if (!saved) onFail()
  }

  return (
    <>
      <AvatarPicker value={value} onChange={change} onBusyChange={setPreparing} disabled={locked} previewSize={PREVIEW_SIZE} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <AccessoryPicker value={choiceOf(value)} onChange={next => void changeWear(next)} disabled={locked || Boolean(value.photo)} {...(value.photo ? { reason: PHOTO_REASON } : {})} />
      {wear.error && <RowError>{wear.error}</RowError>}
      {wear.notice && <RowNotice>{wear.notice}</RowNotice>}
    </>
  )
}
