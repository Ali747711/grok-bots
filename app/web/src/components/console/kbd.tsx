import type { ReactNode } from 'react'

import { Kbd as KbdBase } from '@/components/ui/kbd'
import { cn } from '@/lib/utils'

interface KbdProps {
  children: ReactNode
  className?: string
}

/** A key hint at console size (10-11 px). */
export function Kbd({ children, className }: KbdProps) {
  return <KbdBase className={cn('h-5 min-w-5 rounded-md bg-lifted px-1 text-[10px] font-semibold shadow-lifted in-data-[slot=tooltip-content]:shadow-none', className)}>{children}</KbdBase>
}
