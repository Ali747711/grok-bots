import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { ScreenControl } from './screen-state'

interface ControlBarProps {
  readonly control: ScreenControl
  readonly botTitle: string
  readonly onTake: () => void
  readonly onHandBack: () => void
  readonly onForce: () => void
}

const CHIP: Record<ScreenControl, string> = {
  bot: 'Bot is in control',
  you: "You're in control",
  someone: 'Someone is in control'
}

/** Who holds the screen, and the one or two actions that change it. */
export function ControlBar({ control, botTitle, onTake, onHandBack, onForce }: ControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge variant="outline" className={cn(control === 'you' && 'border-contrast-danger text-contrast-danger', control === 'bot' && 'border-sky text-sky-ink')}>{CHIP[control]}</Badge>
      {control !== 'you' && <Button size="sm" onClick={onTake}>Take control</Button>}
      {control === 'you' && <Button size="sm" variant="outline" onClick={onHandBack}>Hand back</Button>}
      {control === 'someone' && <Button size="sm" variant="outline" onClick={onForce}>Give control back to {botTitle}</Button>}
    </div>
  )
}
