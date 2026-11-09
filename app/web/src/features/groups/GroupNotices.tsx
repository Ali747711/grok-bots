import { Button } from '@/components/ui/button'
import type { GroupTurnAction } from '@/state/types'

import type { GroupItem } from './room-reducer'

type Notice = Extract<GroupItem, { kind: 'notice' }>

/** One notice line, with Keep going when the room can continue. */
export function NoticeRow({ item, onKeepGoing }: { item: Notice; onKeepGoing: (discussionEventId: string) => void }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <p className={item.tone === 'warn' ? 'rounded-full bg-muted px-3 py-1 text-center text-xs text-destructive' : 'rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground'}>
        {item.text}
      </p>
      {item.action && (
        <Button type="button" size="xs" variant="outline" onClick={() => onKeepGoing(item.action!.discussionEventId)}>Keep going</Button>
      )}
    </div>
  )
}

interface TurnActionsProps {
  actions: readonly GroupTurnAction[]
  titleOf: (memberId: string) => string
  onRetry: (action: GroupTurnAction) => void
  onDiscard: (action: GroupTurnAction) => void
}

/** Try again / Dismiss for turns Hermes offers to retry or drop. */
export function TurnActions({ actions, titleOf, onRetry, onDiscard }: TurnActionsProps) {
  if (actions.length === 0) return null
  const members = [...new Set(actions.map(a => a.memberId))]
  return (
    <div className="flex flex-col gap-1.5">
      {members.map(memberId => (
        <div key={memberId} className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <span>{`${titleOf(memberId)} couldn't reply.`}</span>
          {actions.filter(a => a.memberId === memberId).map(a => (
            <Button key={a.kind} type="button" size="xs" variant="outline" onClick={() => (a.kind === 'retry' ? onRetry(a) : onDiscard(a))}>
              {a.kind === 'retry' ? 'Try again' : 'Dismiss'}
            </Button>
          ))}
        </div>
      ))}
    </div>
  )
}
