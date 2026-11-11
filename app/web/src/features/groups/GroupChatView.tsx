import { type ReactNode, useCallback, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { composerDisabledReason, DEFAULT_MAX_WORKING_BOTS } from '@/features/chat/disabled-reason'
import { submitAnswer } from '@/features/requests/answer-request'
import { RequestCard } from '@/features/requests/RequestCard'
import type { BotView, CrewState, GroupView } from '@/state/types'

import { GroupComposer } from './GroupComposer'
import { GroupHeader } from './GroupHeader'
import { GroupMessageList } from './GroupMessageList'
import { ErrorDot, TurnActions } from './GroupNotices'
import { LiveRows } from './LiveRows'
import { joinAnd, memberTitle } from './group-titles'
import { StackedAvatars } from './StackedAvatars'
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
    <div className="grid flex-1 content-center justify-items-center gap-3 text-[13px] font-medium text-muted-foreground">
      <p className="text-[15px] font-semibold tracking-tight text-foreground">Group not found</p>
      <Link to="/" className="rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring">Back to your bots</Link>
    </div>
  )
}

const BANNER = 'mx-4 mb-2 flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-raised px-3 py-2 text-xs font-medium text-foreground'

/** A problem with the group's next turn: a neutral strip with an error dot, its text and one way out. */
function StuckBanner({ text, children }: { text: string; children: ReactNode }) {
  return (
    <div role="alert" className={BANNER}>
      <ErrorDot />
      <p className="min-w-0 break-words">{text}</p>
      {children}
    </div>
  )
}

/** What a group shows before its first message: who is in it and how to ask one of them. */
function EmptyGroup({ group, bots, titleOf }: { group: GroupView; bots: readonly BotView[]; titleOf: (memberId: string) => string }) {
  const members = group.members.map(m => {
    const bot = bots.find(b => b.name === m.profile) ?? null
    return bot ? { ...bot, status: 'idle' as const } : null
  })
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-center">
      <StackedAvatars bots={members} size={56} max={4} />
      <p className="text-[15px] font-semibold tracking-tight">Start with {group.name}</p>
      <p className="max-w-80 text-[13px] font-medium text-muted-foreground">{`${joinAnd(group.members.map(m => titleOf(m.memberId)))} are here. Type @ to ask one of them.`}</p>
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
  const stale = state.hermes !== 'connected' || !crewConnected
  const room = useGroupRoom(group, titleOf, !stale)
  const [newTopic, setNewTopic] = useState(false)
  const [recovering, setRecovering] = useState(false)
  const profiles = new Set(group.members.map(m => m.profile))
  // A group runs one member at a time, so only bots outside it count against the limit.
  const othersWorking = bots.filter(b => b.status === 'working' && !profiles.has(b.name)).length
  const reason = composerDisabledReason({
    hermes: state.hermes, crewConnected, canSend: true, othersWorking,
    maxWorkingBots: state.settings ? state.settings.maxWorkingBots : DEFAULT_MAX_WORKING_BOTS
  })
  const requests = state.pending.filter(p => p.source === 'group' && p.group?.roomId === group.id).sort((a, b) => a.receivedAt - b.receivedAt)
  // Stop fences the poisoned topic in Hermes; the next send then opens a fresh one.
  const recover = async () => {
    setRecovering(true)
    await room.stop()
    setNewTopic(true)
    setRecovering(false)
  }
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
        <GroupMessageList
          items={room.items} group={group} bots={bots} cut={room.cut} footer={footer}
          onRetry={id => void room.retrySend(id)} onKeepGoing={id => void room.keepGoing(id)}
          // Only once the log has loaded: before that, "no messages" is not known yet.
          empty={room.loading ? undefined : <EmptyGroup group={group} bots={bots} titleOf={titleOf} />}
        />
      )}
      {room.error && (
        <div role="status" className="flex items-center justify-center gap-2 px-4 pb-2 text-xs font-medium text-muted-foreground">
          <p data-testid="room-error">{room.error}</p>
          <Button type="button" size="xs" variant="outline" onClick={() => void room.retry()}>Try again</Button>
        </div>
      )}
      {requests.length > 0 && (
        <div className="max-h-[40vh] flex-none scroll-thin overflow-y-auto px-4 pt-2 pb-3">
          <div className="mx-auto flex max-w-[720px] flex-col gap-2">
            {requests.map(entry => (
              <RequestCard key={entry.id} entry={entry} botTitle={titleOf(entry.group!.memberId)} onAnswer={(e, body) => submitAnswer(e.id, body)} />
            ))}
          </div>
        </div>
      )}
      {group.stuckReason === 'topic_limit' && (
        <StuckBanner text="This group is stuck in Hermes: one topic grew past the 24 messages Hermes can track.">
          <Button type="button" size="xs" variant="outline" disabled={recovering} onClick={() => void recover()}>Stop and start a new topic</Button>
        </StuckBanner>
      )}
      {group.stuckReason === 'prepare_failed' && group.prepareRetry && (
        <StuckBanner text={`Hermes can't start this group's next turn: ${group.lastError ?? 'unknown error'}`}>
          <Button type="button" size="xs" variant="outline" disabled={group.working} onClick={() => void room.retryTurn({ kind: 'retry', ...group.prepareRetry! })}>Try again</Button>
        </StuckBanner>
      )}
      <GroupComposer
        topicFull={room.topicFull}
        armed={newTopic}
        onArmed={setNewTopic}
        view={group}
        members={bots}
        titleOf={titleOf}
        firstInTopic={room.topic === null}
        running={group.working && !stale}
        disabledReason={reason}
        onSend={(text, opts) => {
          void room.send(text, opts)
          setNewTopic(false)
        }}
        onStop={() => void room.stop()}
      />
    </>
  )
}

/** One group's chat: header, transcript with live rows, approvals and the composer. */
export function GroupChatView({ state, crewConnected, roomId, panelOpen, onPanel }: GroupChatViewProps) {
  const group = state.groups?.rooms.find(r => r.id === roomId)
  if (!group) return <GroupNotFound />
  return <GroupChat state={state} crewConnected={crewConnected} group={group} panelOpen={panelOpen} onPanel={onPanel} />
}
