import { Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { LiveHandle } from './use-live-view'

interface LiveViewProps {
  readonly live: LiveHandle
  /** True while the red control frame should show (we hold the lease). */
  readonly inControl?: boolean
  readonly expanded?: boolean
  readonly onExpand?: () => void
  readonly onCollapse?: () => void
}

/**
 * Only the canvas host. It attaches on mount and detaches on unmount; the owner's hook keeps the
 * viewer id and the lease, so remounting here (panel to Expand) never hands control back.
 */
export function LiveView({ live, inControl = false, expanded = false, onExpand, onCollapse }: LiveViewProps) {
  const host = useRef<HTMLDivElement>(null)
  const { attach, detach } = live
  useEffect(() => {
    const el = host.current
    if (!el) return
    attach(el)
    return () => detach(el)
  }, [attach, detach])

  const waiting = live.link === 'connecting' || live.link === 'reconnecting'
  return (
    <div className={cn('relative aspect-video w-full overflow-hidden rounded-lg bg-contrast', inControl && 'ring-2 ring-contrast-danger')} data-testid="live-view">
      <div ref={host} className="size-full" />
      {waiting && <Skeleton role="status" className="absolute inset-0 rounded-lg" aria-label="Connecting to the screen" />}
      {live.link === 'failed' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-contrast/80 p-4 text-center text-sm text-contrast-foreground">
          <p>{live.error ?? 'The screen connection failed.'}</p>
          <Button size="sm" variant="contrast-outline" onClick={live.reconnect}>Reconnect</Button>
        </div>
      )}
      {live.notice && <p role="status" className="absolute inset-x-2 bottom-2 rounded bg-contrast/80 px-2 py-1 text-xs text-contrast-foreground">{live.notice}</p>}
      {(onExpand || onCollapse) && (
        <Button size="icon-xs" variant="contrast-outline" className="absolute right-2 top-2" aria-label={expanded ? 'Close expanded view' : 'Expand the screen'} onClick={expanded ? onCollapse : onExpand}>
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
      )}
    </div>
  )
}
