import { BotAvatar } from 'bot-avatars'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { PhotoError, toAvatarPng } from '@/features/bots/image'
import { cn } from '@/lib/utils'

import { AVATAR_SWATCHES, AVATAR_TYPES, type AvatarType } from './avatar-model'
import { CrewAvatar } from './CrewAvatar'

export interface AvatarValue {
  readonly type: AvatarType
  /** `#rrggbb`; undefined means the type's own colour. */
  readonly color?: string
  /** 256 px PNG data url, or null/undefined for none. */
  readonly photo?: string | null
}

interface AvatarPickerProps {
  value: AvatarValue
  onChange: (next: AvatarValue) => void
  /** True while a picked photo is being prepared, so the caller can hold its submit button. */
  onBusyChange?: (busy: boolean) => void
  /** Fires only when the user clicks a type (not for colour or photo changes). */
  onTypePick?: (type: AvatarType) => void
}

const PREVIEW_SIZE = 72
const RING = 'ring-2 ring-foreground ring-offset-2 ring-offset-popover'

function TypeGrid({ value, onChange, onTypePick }: Pick<AvatarPickerProps, 'value' | 'onChange' | 'onTypePick'>) {
  return (
    <div role="group" aria-label="Type" className="grid grid-cols-6 gap-1.5">
      {AVATAR_TYPES.map(type => (
        <button
          key={type}
          type="button"
          aria-label={type}
          aria-pressed={value.type === type}
          onClick={() => {
            onTypePick?.(type)
            onChange({ ...value, type })
          }}
          className={cn('grid place-items-center rounded-xl bg-muted p-1 transition-shadow', value.type === type && RING)}
        >
          <BotAvatar shading="fabric" type={type} {...(value.color ? { color: value.color } : {})} size={44} paused interactive={false} />
        </button>
      ))}
    </div>
  )
}

function Swatches({ value, onChange }: Pick<AvatarPickerProps, 'value' | 'onChange'>) {
  const { color, ...rest } = value
  return (
    <div role="group" aria-label="Colour" className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        aria-pressed={color === undefined}
        onClick={() => onChange(rest)}
        className={cn('h-6 rounded-full bg-muted px-2.5 text-xs font-medium', color === undefined && 'bg-foreground text-background')}
      >
        Default
      </button>
      {AVATAR_SWATCHES.map(s => (
        <button
          key={s.hex}
          type="button"
          aria-label={s.name}
          aria-pressed={color === s.hex}
          onClick={() => onChange({ ...value, color: s.hex })}
          className={cn('size-6 rounded-full', color === s.hex && RING)}
          style={{ backgroundColor: s.hex }}
        />
      ))}
    </div>
  )
}

function PhotoControls({ value, onChange, onBusyChange }: AvatarPickerProps) {
  const [error, setError] = useState<string | null>(null)
  const [preparing, setPreparing] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const pick = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    setPreparing(true)
    onBusyChange?.(true)
    try {
      onChange({ ...value, photo: await toAvatarPng(file) })
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : 'Could not read that image')
    } finally {
      setPreparing(false)
      onBusyChange?.(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-label="Upload photo"
          className="hidden"
          onChange={e => {
            void pick(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}>Upload photo</Button>
        {value.photo && <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ ...value, photo: null })}>Remove photo</Button>}
        {preparing && <span role="status" className="text-xs text-muted-foreground">Preparing photo…</span>}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </>
  )
}

/** The photo's preview, or the fur avatar as it will look. Decorative: the controls around it name the choices. */
function Preview({ value }: { value: AvatarValue }) {
  const look = { name: 'preview', title: 'Preview', avatar: { type: value.type, ...(value.color ? { color: value.color } : {}) }, imageKind: null, hasAvatar: false, status: 'idle' as const, hidden: false, lastActive: null }
  return (
    <div data-testid="avatar-preview" className="flex-none" style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE }}>
      {value.photo ? (
        <img src={value.photo} alt="Photo preview" className="size-full rounded-[30%] object-cover" />
      ) : (
        <CrewAvatar bot={look} size={PREVIEW_SIZE} interactive={false} decorative />
      )}
    </div>
  )
}

/** Choose a bot's avatar: one of 18 plush types, a colour, or an uploaded photo, with a live preview. */
export function AvatarPicker({ value, onChange, onBusyChange, onTypePick }: AvatarPickerProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <Preview value={value} />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Swatches value={value} onChange={onChange} />
          <PhotoControls value={value} onChange={onChange} onBusyChange={onBusyChange} />
        </div>
      </div>
      <TypeGrid value={value} onChange={onChange} onTypePick={onTypePick} />
    </div>
  )
}
