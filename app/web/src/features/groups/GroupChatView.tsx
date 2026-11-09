import { useCallback } from 'react'
import { Link } from 'react-router-dom'

import { Skeleton } from '@/components/ui/skeleton'
import { Composer } from '@/features/chat/Composer'
import { composerDisabledReason, DEFAULT_MAX_WORKING_BOTS } from '@/features/chat/disabled-reason'
import { submitAnswer } from '@/features/requests/answer-request'
import { RequestCard } from '@/features/requests/RequestCard'
import type { BotView, CrewState, GroupView } from '@/state/types'

import { GroupHeader } from './GroupHeader'
import { GroupMessageList } from './GroupMessageList'
import { TurnActions } from './GroupNotices'
import { LiveRows } from './LiveRows'
import { memberTitle } from './group-titles'
import { useGroupRoom } from './use-group-room'

interface GroupChatViewProps {
  state: CrewState
  /** Browser-to-Crew stream is up. */
  crewConnected: boolean
  roomId: string
  panelOpen: boolean
  onPanel: () => void
}

function GroupNotFound() {
  return (
    <div className="grid flex-1 content-center justify-items-center gap-3 text-sm text-muted-foreground">
      <p className="text-base font-medium text-foreground">Group not found</p>
      <Link to="/" className="text-sky-ink underline underline-offset-2">Back to your bots</Link>
    </div>
  )
}

function ChatSkeleton() {
  return (
    <div data-testid="chat-skeleton" aria-hidden="true" className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-6">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="ml-auto h-9 w-1/3" />
      <Skeleton className="h-16 w-3/4" />
    </div>
  )
}

function GroupChat({ state, crewConnected, group, panelOpen, onPanel }: Omit<GroupChatViewProps, 'roomId'> & { group: GroupView }) {
  const bots: readonly BotView[] = state.bots
  const titleOf = useCallback((memberId: string) => memberTitle(group, bots, memberId), [group, bots])
  const room = useGroupRoom(group, titleOf)
  const stale = state.hermes !== 'connected' || !crewConnected
  const profiles = new Set(group.members.map(m => m.profile))
  // A group runs one member at a time, so only bots outside it count against the limit.
  const othersWorking = bots.filter(b => b.status === 'working' && !profiles.has(b.name)).length
  const reason = composerDisabledReason({
    hermes: state.hermes, crewConnected, canSend: true, othersWorking,
    maxWorkingBots: state.settings ? state.settings.maxWorkingBots : DEFAULT_MAX_WORKING_BOTS
  })
  const requests = state.pending.filter(p => p.source === 'group' && p.group?.roomId === group.id).sort((a, b) => a.receivedAt - b.receivedAt)
  const footer = (
    <>
      <TurnActions actions={group.turnActions} titleOf={titleOf} onRetry={a => void room.retryTurn(a)} onDiscard={a => void room.discardTurn(a)} />
      {!stale && <LiveRows group={group} titleOf={titleOf} />}
    </>
  )

  return (
    <>
      <GroupHeader group={group} bots={bots} stale={stale} panelOpen={panelOpen} onPanel={onPanel} onStop={() => void room.stop()} />
      {room.loading && room.items.length === 0 && !stale ? (
        <ChatSkeleton />
      ) : (
        <GroupMessageList items={room.items} group={group} bots={bots} cut={room.cut} onRetry={id => void room.retrySend(id)} onKeepGoing={id => void room.keepGoing(id)} footer={footer} />
      )}
      {room.error && <p role="status" className="px-6 text-center text-xs text-muted-foreground">{room.error}</p>}
      {requests.length > 0 && (
        <div className="max-h-[40vh] flex-none overflow-y-auto px-6 pt-2">
          <div className="mx-auto flex max-w-[720px] flex-col gap-2">
            {requests.map(entry => (
              <RequestCard key={entry.id} entry={entry} botTitle={titleOf(entry.group!.memberId)} onAnswer={(e, body) => submitAnswer(e.id, body)} />
            ))}
          </div>
        </div>
      )}
      {/* Task 8 swaps this for the group composer with mention help and New topic. */}
      <Composer disabledReason={reason} running={group.working} onSend={text => void room.send(text, { newTopic: false })} onStop={() => void room.stop()} />
    </>
  )
}

/** One group's chat: header, transcript with live rows, approvals and the composer. */
export function GroupChatView({ state, crewConnected, roomId, panelOpen, onPanel }: GroupChatViewProps) {
  const group = state.groups?.rooms.find(r => r.id === roomId)
  if (!group) return <GroupNotFound />
  return <GroupChat state={state} crewConnected={crewConnected} group={group} panelOpen={panelOpen} onPanel={onPanel} />
}
