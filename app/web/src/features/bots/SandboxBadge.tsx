import { ShieldCheck } from 'lucide-react'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/** A span, not a button: the roster row that holds it is already a button. */
export function SandboxBadge() {
  return (
    <Tooltip>
      <TooltipTrigger render={<span role="img" aria-label="Sandboxed" className="inline-flex shrink-0" />}>
        <ShieldCheck className="size-3.5 text-muted-foreground" aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent>Sandboxed</TooltipContent>
    </Tooltip>
  )
}
