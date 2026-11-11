import { Button } from '@/components/ui/button'
import type { GroupTurnAction } from '@/state/types'

import type { GroupItem } from './room-reducer'

type Notice = Extract<GroupItem, { kind: 'notice' }>

/** The red dot that marks a problem on a neutral surface (PF31: never destructive text on a tinted fill). */
export function ErrorDot() {
  return <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-status-error" />
}

/** One notice line, with Keep going when the room can continue. A problem is a neutral pill with an error dot. */
export function NoticeRow({ item, onKeepGoing }: { item: Notice; onKeepGoing: (discussionEventId: string) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {item.tone === 'warn' ? (
        <p className="inline-flex max-w-full items-center gap-2 rounded-2xl bg-raised px-3 py-1 text-xs font-medium text-foreground">
          <ErrorDot />
          <span className="min-w-0 break-words">{item.text}</span>
        </p>
      ) : (
        <p className="text-center text-xs font-medium text-faint">{item.text}</p>
      )}
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
        <div key={memberId} className="flex flex-wrap items-center justify-center gap-2 text-xs font-medium text-muted-foreground">
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
