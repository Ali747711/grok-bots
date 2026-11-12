import type { KeyboardEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import { motion } from 'motion/react'

import { slide } from '@/lib/motion'
import { cn } from '@/lib/utils'

export interface TabItem<T extends string> {
  id: T
  label: string
  icon: LucideIcon
}

interface SegmentedTabsProps<T extends string> {
  tabs: TabItem<T>[]
  value: T
  onChange: (id: T) => void
  /** Accessible name for the tab list. */
  label: string
  /** Prefix for tab ids; the panel uses `${idPrefix}-panel`. */
  idPrefix: string
  className?: string
}

/** Pill tab list with a sliding active pill. One tab is tabbable; arrows, Home and End move and select. */
export function SegmentedTabs<T extends string>({ tabs, value, onChange, label, idPrefix, className }: SegmentedTabsProps<T>) {
  const focusTab = (index: number) => {
    const next = tabs[(index + tabs.length) % tabs.length]!
    onChange(next.id)
    document.getElementById(`${idPrefix}-tab-${next.id}`)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Leave browser shortcuts such as Alt+Left (history back) alone.
    if (event.altKey || event.metaKey || event.ctrlKey) return
    const current = tabs.findIndex(tab => tab.id === value)
    const targets: Record<string, number> = { ArrowRight: current + 1, ArrowLeft: current - 1, Home: 0, End: tabs.length - 1 }
    const target = targets[event.key]
    if (target === undefined) return
    event.preventDefault()
    focusTab(target)
  }

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn('flex items-center gap-0.5 rounded-full bg-background p-1', className)}>
      {tabs.map(tab => {
        const active = tab.id === value
        return (
          <button
            key={tab.id}
            id={`${idPrefix}-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={`${idPrefix}-panel`}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring',
              active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {active && <motion.span layoutId={`${idPrefix}-active-pill`} transition={slide} className="absolute inset-0 rounded-full bg-lifted shadow-lifted" />}
            <tab.icon className="relative size-4" aria-hidden="true" />
            <span className="relative">{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
