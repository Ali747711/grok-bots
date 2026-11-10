import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { ScreenControl } from './screen-state'

interface ControlBarProps {
  readonly control: ScreenControl
  /** The view is live: Take control needs a stream to control. */
  readonly connected: boolean
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
export function ControlBar({ control, connected, botTitle, onTake, onHandBack, onForce }: ControlBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge role="status" aria-live="polite" variant="outline" className={cn(control === 'you' && 'border-destructive text-destructive', control === 'bot' && 'border-border text-foreground')}>{CHIP[control]}</Badge>
      {control !== 'you' && <Button size="sm" onClick={onTake} disabled={!connected}>Take control</Button>}
      {control === 'you' && <Button size="sm" variant="outline" onClick={onHandBack}>Hand back</Button>}
      {control === 'someone' && <Button size="sm" variant="outline" onClick={onForce}>Give control back to {botTitle}</Button>}
    </div>
  )
}
