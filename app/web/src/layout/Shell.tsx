import { type ReactNode, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

interface ShellProps {
  /** The crew rail. */
  rail: ReactNode
  /** The work area: a conversation, or a page that replaces it (profile, Needs you). */
  main: ReactNode
  /** The side panel beside the conversation, or null for none. */
  side: ReactNode | null
}

// Below 1280 px there is no room for the conversation and a useful side panel side by side, so the panel overlays.
const NARROW = '(max-width: 1279px)'

/** True while the window is narrower than 1280 px (false where matchMedia is missing). */
function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.(NARROW).matches ?? false)
  useEffect(() => {
    const media = window.matchMedia?.(NARROW)
    if (!media) return undefined
    const onChange = (e: { matches: boolean }) => setNarrow(e.matches)
    setNarrow(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return narrow
}

const PANEL = 'min-h-0 min-w-0 rounded-3xl bg-shell'
// tailwind-merge does not know `shadow-panel` is a box shadow, so a panel takes exactly one of the two.
const FLOAT = 'shadow-panel'

/**
 * Three floating panels on the page canvas: the rail, the work area and the side panel. Beside a side
 * panel the conversation keeps a narrow column and the panel takes the rest; on narrow windows the
 * panel overlays the conversation instead.
 */
export function Shell({ rail, main, side }: ShellProps) {
  const narrow = useNarrow()
  const overlay = narrow && side !== null
  const beside = side !== null && !overlay
  return (
    <div className="relative isolate flex h-dvh gap-2 overflow-hidden bg-background p-2 text-foreground">
      <aside aria-label="Sidebar" className={cn(PANEL, FLOAT, 'flex w-[272px] flex-none flex-col overflow-y-auto px-2.5 py-3.5')}>
        {rail}
      </aside>
      <main className={cn(PANEL, FLOAT, 'flex flex-col overflow-hidden', beside ? 'w-[clamp(380px,32vw,480px)] flex-none' : 'flex-1')}>{main}</main>
      {side !== null && (
        <section
          aria-label="Panel"
          data-overlay={overlay ? 'true' : undefined}
          className={cn(
            PANEL,
            'flex flex-col overflow-y-auto',
            overlay ? 'absolute inset-y-2 right-2 z-20 w-[min(480px,calc(100%-16px))] shadow-2xl' : cn(FLOAT, 'flex-1')
          )}
        >
          {side}
        </section>
      )}
    </div>
  )
}
