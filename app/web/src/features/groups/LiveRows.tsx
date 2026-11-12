import { cn } from '@/lib/utils'
import type { GroupView } from '@/state/types'

type Activity = GroupView['activity'][number]

interface LiveRowsProps {
  group: GroupView
  titleOf: (memberId: string) => string
}

function rowText(a: Activity, title: string): string {
  if (a.status === 'queued') return `Up next: ${title}`
  if (a.stalled) return `${title} seems stuck`
  if (a.status === 'stopping') return `${title} is stopping…`
  return a.tool ? `${title} is using ${a.tool}…` : `${title} is working…`
}

/** The dot beside a row: moving while the member works, still while it waits, red when it seems stuck. */
function dotClass(a: Activity): string {
  if (a.status === 'queued') return 'bg-status-idle'
  if (a.stalled) return 'bg-status-error'
  return 'bg-status-working motion-safe:animate-pulse'
}

/** What each member is doing right now, from the room's live activity. */
export function LiveRows({ group, titleOf }: LiveRowsProps) {
  if (group.activity.length === 0) return null
  return (
    <div className="flex flex-col gap-1.5">
      {group.activity.map(a => (
        <div key={a.memberId} className="flex items-center gap-2 pl-2.5">
          <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', dotClass(a))} />
          <p role="status" className="min-w-0 truncate text-xs font-medium text-muted-foreground">{rowText(a, titleOf(a.memberId))}</p>
        </div>
      ))}
    </div>
  )
}
