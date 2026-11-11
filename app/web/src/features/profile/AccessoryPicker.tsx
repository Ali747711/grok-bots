import { ChoiceChips, type Option, Section, Switch } from '@/components/console/fields'
import type { AvatarFace, AvatarGlasses, AvatarHat } from '@/features/avatars/avatar-model'
import type { AvatarChoice } from '@/features/bots/types'

import { Note } from './RowNotes'

interface AccessoryPickerProps {
  /** The avatar as it is now; an accessory it does not name shows the library's default. */
  value: AvatarChoice
  /** The whole avatar with one accessory changed. */
  onChange: (next: AvatarChoice) => void
  disabled?: boolean
  /** Why the picker is held, shown above it. */
  reason?: string
}

const FACES: Option<AvatarFace>[] = [
  { value: 'eyes', label: 'Eyes' },
  { value: 'mouth', label: 'Mouth' }
]

const HATS: Option<AvatarHat>[] = [
  { value: 'none', label: 'None' },
  { value: 'beret', label: 'Beret' },
  { value: 'beanie', label: 'Beanie' },
  { value: 'party', label: 'Party' },
  { value: 'crown', label: 'Crown' }
]

const GLASSES: Option<AvatarGlasses>[] = [
  { value: 'none', label: 'None' },
  { value: 'round', label: 'Round' },
  { value: 'square', label: 'Square' },
  { value: 'shades', label: 'Shades' }
]

interface ExtraRowProps {
  label: string
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}

function ExtraRow({ label, checked, disabled, onChange }: ExtraRowProps) {
  return (
    <div className="flex h-11 items-center justify-between rounded-full bg-shell pr-2.5 pl-4">
      <span className="text-[13px] font-medium">{label}</span>
      <Switch checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  )
}

/** What a shape avatar wears: its face, a hat, glasses, headphones and a bow tie. Each pick is reported at once. */
export function AccessoryPicker({ value, onChange, disabled = false, reason }: AccessoryPickerProps) {
  const set = (change: Partial<AvatarChoice>) => {
    // A held picker reports nothing, whatever the browser lets through.
    if (!disabled) onChange({ ...value, ...change })
  }
  return (
    <>
      {reason && <Note>{reason}</Note>}
      <Section title="Face">
        <ChoiceChips legend="Face" value={value.face ?? 'eyes'} options={FACES} onChange={face => set({ face })} disabled={disabled} />
      </Section>
      <Section title="Hat">
        <ChoiceChips legend="Hat" value={value.hat ?? 'none'} options={HATS} onChange={hat => set({ hat })} disabled={disabled} />
      </Section>
      <Section title="Glasses">
        <ChoiceChips legend="Glasses" value={value.glasses ?? 'none'} options={GLASSES} onChange={glasses => set({ glasses })} disabled={disabled} />
      </Section>
      <Section title="Extras">
        <div className="flex flex-col gap-0.5">
          <ExtraRow label="Headphones" checked={value.headphones === true} disabled={disabled} onChange={headphones => set({ headphones })} />
          <ExtraRow label="Bow tie" checked={value.bowTie === true} disabled={disabled} onChange={bowTie => set({ bowTie })} />
        </div>
      </Section>
    </>
  )
}
