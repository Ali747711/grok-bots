import { Hand } from 'lucide-react'

import { Button } from '@/components/ui/button'

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

/**
 * The one or two actions that change who holds the screen. Who holds it now is said by the side
 * panel's link chip, not here (ruling R11).
 */
export function ControlBar({ control, connected, botTitle, onTake, onHandBack, onForce }: ControlBarProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-1.5">
      {control !== 'you' && (
        <Button onClick={onTake} disabled={!connected}>
          <Hand data-icon="inline-start" aria-hidden="true" />
          Take control
        </Button>
      )}
      {control === 'you' && (
        <Button variant="outline" onClick={onHandBack}>
          <span aria-hidden="true" className="size-1.5 rounded-full bg-watermelon" />
          Hand back
        </Button>
      )}
      {control === 'someone' && <Button variant="outline" onClick={onForce}>Give control back to {botTitle}</Button>}
    </div>
  )
}
