import { MousePointer2 } from 'lucide-react'

import type { WorkStep } from '@/chat/types'
import { BlurSwap } from '@/components/console/motion-bits'

const IDLE = 'Idle'

/** What the bot is doing right now: its running step, or "Idle". Adapted from crew-bots' now strip, without the meters. */
export function NowStrip({ step }: { step: WorkStep | null }) {
  const text = step?.summary || IDLE
  return (
    <div data-slot="now-strip" className="flex h-11 shrink-0 items-center gap-3 rounded-full bg-background pr-4 pl-1.5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-shell text-faint">
        <MousePointer2 className="size-4" aria-hidden="true" />
      </span>
      <p aria-live="polite" className="relative min-w-0 flex-1 text-[13px] font-medium">
        <BlurSwap id={step ? `${step.id}:${text}` : IDLE}>{text}</BlurSwap>
      </p>
    </div>
  )
}
