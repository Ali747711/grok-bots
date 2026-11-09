import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface ShellProps {
  sidebar: ReactNode
  main: ReactNode
  panel: ReactNode
  panelOpen: boolean
}

/** Three-column layout: 272 px sidebar, flexible chat, 400 px panel (only while open). */
export function Shell({ sidebar, main, panel, panelOpen }: ShellProps) {
  return (
    <div
      className={cn(
        'grid h-dvh grid-rows-[minmax(0,1fr)] overflow-hidden bg-background text-foreground',
        panelOpen ? 'grid-cols-[272px_minmax(0,1fr)_400px]' : 'grid-cols-[272px_minmax(0,1fr)]'
      )}
    >
      <aside aria-label="Sidebar" className="flex min-h-0 min-w-0 flex-col overflow-y-auto border-r border-border px-2.5 py-3.5">
        {sidebar}
      </aside>
      <main className="flex min-h-0 min-w-0 flex-col overflow-hidden">{main}</main>
      {panelOpen && (
        <section aria-label="Panel" className="flex min-h-0 min-w-0 flex-col overflow-y-auto border-l border-border">
          {panel}
        </section>
      )}
    </div>
  )
}
