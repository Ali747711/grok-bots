import { useId } from 'react'
import { BarChart3, Compass, Minus, Search, Terminal, Wrench, type LucideIcon } from 'lucide-react'

import { BOT_ROLES, ROLE_LABELS, type BotRole } from '@/features/bots/roles'

interface RolePickerProps {
  value: BotRole | null
  onChange: (role: BotRole | null) => void
  disabled?: boolean
}

const ROLE_ICONS: Record<BotRole, LucideIcon> = {
  researcher: Search,
  engineer: Terminal,
  operator: Wrench,
  analyst: BarChart3,
  ops: Compass,
  generalist: Minus
}

interface RoleChoice {
  role: BotRole | null
  label: string
  icon: LucideIcon
}

const CHOICES: readonly RoleChoice[] = [
  ...BOT_ROLES.map(role => ({ role, label: ROLE_LABELS[role], icon: ROLE_ICONS[role] })),
  { role: null, label: 'None', icon: Minus }
]

/** Role choice as an icon grid, with real radio inputs underneath. "None" clears the role. */
export function RolePicker({ value, onChange, disabled = false }: RolePickerProps) {
  const name = useId()
  return (
    <fieldset role="radiogroup" disabled={disabled} className="disabled:opacity-60">
      <legend className="sr-only">Role</legend>
      <div className="grid grid-cols-4 gap-1">
        {CHOICES.map(({ role, label, icon: Icon }) => (
          <label key={role ?? 'none'} className="cursor-pointer">
            <input type="radio" name={name} value={role ?? ''} checked={value === role} onChange={() => onChange(role)} className="peer sr-only" />
            <span className="flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3 text-muted-foreground transition-colors peer-checked:bg-raised peer-checked:text-foreground peer-focus-visible:ring-3 peer-focus-visible:ring-ring hover:text-foreground">
              <Icon className="size-[18px]" aria-hidden="true" />
              <span className="text-[11px] font-medium">{label}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
