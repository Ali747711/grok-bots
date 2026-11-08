import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { PhotoError, toAvatarPng } from './image'
import type { BotLook } from './types'

export const COLORS = [
  { hex: '#6366f1', name: 'Indigo' },
  { hex: '#7c3aed', name: 'Violet' },
  { hex: '#db2777', name: 'Pink' },
  { hex: '#dc2626', name: 'Red' },
  { hex: '#ea580c', name: 'Orange' },
  { hex: '#16a34a', name: 'Green' },
  { hex: '#0891b2', name: 'Cyan' },
  { hex: '#475569', name: 'Slate' }
] as const

export interface LookValue {
  readonly look: BotLook
  /** 256 px PNG data url, or undefined for a plain shape. */
  readonly image?: string
}

interface LookPickerProps {
  value: LookValue
  onChange: (next: LookValue) => void
  /** First letter of the title, shown in the preview when there is no photo. */
  initial?: string
}

const shapeClass = (shape: BotLook['shape']) => (shape === 'circle' ? 'rounded-full' : 'rounded-[10px]')

/** Shape, colour and optional photo, with a live preview. */
export function LookPicker({ value, onChange, initial = '?' }: LookPickerProps) {
  const [error, setError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const { look, image } = value

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return
    setError(null)
    try {
      onChange({ look, image: await toAvatarPng(file) })
    } catch (e) {
      setError(e instanceof PhotoError ? e.message : 'Could not read that image')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <div
          data-testid="look-preview"
          className={cn('grid size-12 flex-none place-items-center overflow-hidden text-lg font-bold text-white', shapeClass(look.shape))}
          style={{ backgroundColor: look.color }}
        >
          {image ? <img src={image} alt="Photo preview" className="size-full object-cover" /> : initial}
        </div>
        <div className="flex gap-1.5" role="group" aria-label="Shape">
          {(['squircle', 'circle'] as const).map(shape => (
            <Button key={shape} type="button" size="sm" variant={look.shape === shape ? 'secondary' : 'outline'} aria-pressed={look.shape === shape} onClick={() => onChange({ ...value, look: { ...look, shape } })}>
              {shape === 'circle' ? 'Circle' : 'Squircle'}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Colour">
        {COLORS.map(c => (
          <button
            key={c.hex}
            type="button"
            aria-label={c.name}
            aria-pressed={look.color === c.hex}
            onClick={() => onChange({ ...value, look: { ...look, color: c.hex } })}
            className={cn('size-6 rounded-full border-2 border-transparent', look.color === c.hex && 'border-foreground')}
            style={{ backgroundColor: c.hex }}
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          aria-label="Upload photo"
          className="hidden"
          onChange={e => {
            void pickPhoto(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        <Button type="button" size="sm" variant="outline" onClick={() => fileInput.current?.click()}>Upload photo</Button>
        {image && <Button type="button" size="sm" variant="ghost" onClick={() => onChange({ look })}>Remove photo</Button>}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
