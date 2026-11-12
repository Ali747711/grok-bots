import { Maximize2, Minimize2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'

import type { LiveHandle } from './use-live-view'

interface LiveViewProps {
  readonly live: LiveHandle
  /** True while the watermelon control frame should show (we hold the lease). */
  readonly inControl?: boolean
  readonly expanded?: boolean
  readonly onExpand?: () => void
  readonly onCollapse?: () => void
}

/**
 * Only the canvas host, framed as the bot's viewport; noVNC scales the picture to it. It attaches on mount and detaches on unmount; the owner's hook keeps the
 * viewer id and the lease, so remounting here (panel to Expand) never hands control back.
 */
export function LiveView({ live, inControl = false, expanded = false, onExpand, onCollapse }: LiveViewProps) {
  const host = useRef<HTMLDivElement>(null)
  // Idle before the first attach is not "disconnected": only show Reconnect once this host has attached.
  const [attached, setAttached] = useState(false)
  const { attach, detach } = live
  useEffect(() => {
    const el = host.current
    if (!el) return
    attach(el)
    setAttached(true)
    return () => detach(el)
  }, [attach, detach])

  const waiting = live.link === 'connecting' || live.link === 'reconnecting'
  const waitingLabel = live.link === 'reconnecting'
    ? (inControl ? 'Reconnecting, you still have control' : 'Reconnecting to the screen')
    : 'Connecting to the screen'
  return (
    <div className={cn('relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-raised transition-shadow', inControl && 'ring-2 ring-watermelon')} data-testid="live-view">
      <div ref={host} className="size-full" />
      {waiting && <Skeleton role="status" className="absolute inset-0 rounded-xl" aria-label={waitingLabel} />}
      {(live.link === 'failed' || (attached && live.link === 'idle')) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-raised p-4 text-center text-[13px] font-medium text-foreground">
          <p>{live.link === 'failed' ? (live.error ?? 'The screen connection failed.') : "The screen isn't connected."}</p>
          <Button size="sm" variant="outline" onClick={live.reconnect}>Reconnect</Button>
        </div>
      )}
      {live.notice && <p role="status" className="absolute inset-x-2 bottom-2 rounded-lg bg-raised px-2 py-1 text-xs font-medium text-foreground">{live.notice}</p>}
      {(onExpand || onCollapse) && (
        <Button size="icon-xs" variant="outline" className="absolute right-2 top-2" aria-label={expanded ? 'Close expanded view' : 'Expand the screen'} onClick={expanded ? onCollapse : onExpand}>
          {expanded ? <Minimize2 /> : <Maximize2 />}
        </Button>
      )}
    </div>
  )
}
