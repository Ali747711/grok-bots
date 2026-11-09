import type { GroupView } from '@/state/types'

interface LiveRowsProps {
  group: GroupView
  titleOf: (memberId: string) => string
}

function rowText(a: GroupView['activity'][number], title: string): string {
  if (a.status === 'queued') return `Up next: ${title}`
  if (a.stalled) return `${title} seems stuck`
  if (a.status === 'stopping') return `${title} is stopping…`
  return a.tool ? `${title} is using ${a.tool}…` : `${title} is working…`
}

/** What each member is doing right now, from the room's live activity. */
export function LiveRows({ group, titleOf }: LiveRowsProps) {
  if (group.activity.length === 0) return null
  return (
    <div className="flex flex-col gap-1">
      {group.activity.map(a => (
        <p key={a.memberId} role="status" className="text-xs text-muted-foreground">{rowText(a, titleOf(a.memberId))}</p>
      ))}
    </div>
  )
}
