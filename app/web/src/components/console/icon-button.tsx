import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'

import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

import { Kbd } from './kbd'

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'aria-pressed'> {
  /** Accessible name; also the tooltip. */
  label: string
  shortcut?: string
  side?: 'top' | 'bottom' | 'left' | 'right'
  /** Makes it a toggle button (aria-pressed). */
  pressed?: boolean
  ref?: Ref<HTMLButtonElement>
  children: ReactNode
}

/** Icon-only button that always carries a name and a tooltip. Rest props (aria-expanded, aria-haspopup) reach the button. */
export function IconButton({ label, shortcut, side = 'top', pressed, className, children, ref, type = 'button', ...rest }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            ref={ref}
            type={type}
            variant="ghost"
            size="icon-sm"
            aria-label={label}
            aria-pressed={pressed}
            className={cn('text-muted-foreground hover:text-foreground', pressed && 'bg-raised text-foreground', className)}
            {...rest}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>
        {label}
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}
