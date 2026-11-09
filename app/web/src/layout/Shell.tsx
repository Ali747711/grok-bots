import { type ReactNode, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

import { SkyCanvas } from './SkyCanvas'

interface ShellProps {
  sidebar: ReactNode
  main: ReactNode
  panel: ReactNode
  panelOpen: boolean
}

// Below 1280 px the chat would drop under ~560 px with the panel open, squeezing the header, so the panel overlays.
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

const BLOCK = 'min-h-0 min-w-0 rounded-block bg-card/95 shadow-sm'

/** Three rounded blocks on the sky canvas: roster, chat, and the panel (an overlay on narrow windows). */
export function Shell({ sidebar, main, panel, panelOpen }: ShellProps) {
  const overlay = useNarrow() && panelOpen
  const threeColumns = panelOpen && !overlay
  return (
    <div
      className={cn(
        'relative isolate grid h-dvh grid-rows-[minmax(0,1fr)] gap-3 overflow-hidden p-3 text-foreground',
        threeColumns ? 'grid-cols-[272px_minmax(0,1fr)_400px]' : 'grid-cols-[272px_minmax(0,1fr)]'
      )}
    >
      <SkyCanvas />
      <aside aria-label="Sidebar" className={cn(BLOCK, 'flex flex-col overflow-y-auto px-2.5 py-3.5')}>
        {sidebar}
      </aside>
      <main className={cn(BLOCK, 'flex flex-col overflow-hidden')}>{main}</main>
      {panelOpen && (
        <section
          aria-label="Panel"
          data-overlay={overlay ? 'true' : undefined}
          className={cn(
            BLOCK,
            'flex flex-col overflow-y-auto',
            overlay && 'absolute inset-y-3 right-3 z-20 w-[min(400px,calc(100%-24px))] bg-card shadow-2xl'
          )}
        >
          {panel}
        </section>
      )}
    </div>
  )
}
