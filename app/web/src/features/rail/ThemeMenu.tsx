import { SunMoon } from 'lucide-react'

import { IconButton } from '@/components/console/icon-button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { type ThemePreference, useThemePreference } from '@/lib/use-theme'

const CHOICES: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

const isChoice = (value: unknown): value is ThemePreference => CHOICES.some(choice => choice.value === value)

/** The rail footer's theme button: a menu with System, Light and Dark. The choice applies and is saved at once. */
export function ThemeMenu() {
  const [preference, setPreference] = useThemePreference()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <IconButton label="Theme">
            <SunMoon />
          </IconButton>
        }
      />
      <DropdownMenuContent side="top" align="end" className="w-36 min-w-36">
        <DropdownMenuRadioGroup
          value={preference}
          onValueChange={value => {
            if (isChoice(value)) setPreference(value)
          }}
        >
          {CHOICES.map(choice => (
            <DropdownMenuRadioItem key={choice.value} value={choice.value}>
              {choice.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
