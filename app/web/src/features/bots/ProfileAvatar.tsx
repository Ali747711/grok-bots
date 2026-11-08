import { useEffect, useRef, useState } from 'react'

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
  /** The held (unsent) pick, or null once it was sent or dropped. */
  heldChoice?: AvatarChoice | null
  onHeld?: (choice: AvatarChoice | null) => void
  /** A form save is in flight: hold the picker so it cannot race it. */
  disabled?: boolean
}

const photoUrl = (detail: BotDetail) => (detail.look.imageKind === 'photo' ? `/crew/avatars/${encodeURIComponent(detail.name)}` : null)

/** The picker's value: the stored avatar, else the type the handle derives (and no colour). */
function valueOf(detail: BotDetail): AvatarValue {
  return { type: detail.avatar?.type ?? deriveAvatarType(detail.name), ...(detail.avatar?.color ? { color: detail.avatar.color } : {}), photo: photoUrl(detail) }
}

const choiceOf = (v: AvatarValue): AvatarChoice => ({ type: v.type, ...(v.color ? { color: v.color } : {}) })

interface SaveDeps {
  /** The latest bot, read when an async save finishes. */
  latest: { readonly current: BotDetail }
  onDetail: (detail: BotDetail) => void
  /** A save failed: put the picker back on what is really stored. */
  onFail: () => void
}

/** One avatar write at a time: a photo goes to the avatar route, a type or colour to PATCH. */
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

/** Avatar editing: type, colour and photo save at once (one write at a time); an unfinished bot only holds its picks. */
export function ProfileAvatar({ detail, onDetail, onBusyChange, held = false, heldChoice = null, onHeld, disabled = false }: ProfileAvatarProps) {
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
  const waiting = useHeldAvatar({ held, heldChoice, onHeld, latest, saving, save, setValue })

  // Follow the saved bot; a held bot keeps its local type and colour (nothing is saved yet).
  useEffect(() => {
    setValue(prev => (held ? { ...prev, photo: photoUrl(detail) } : valueOf(detail)))
  }, [detail, held])
  useEffect(() => onBusyChange(saving || preparing || waiting), [saving, preparing, waiting, onBusyChange])

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
      <AvatarPicker value={value} onChange={change} onBusyChange={setPreparing} disabled={disabled || saving || preparing || waiting} />
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </>
  )
}
