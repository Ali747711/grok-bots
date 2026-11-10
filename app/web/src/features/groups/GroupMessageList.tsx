import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { Markdown } from '@/features/chat/Markdown'
import type { BotView, GroupMemberView, GroupView } from '@/state/types'

import { memberTitle } from './group-titles'
import { NoticeRow } from './GroupNotices'
import { markMentions } from './mention-markdown'
import type { GroupItem } from './room-reducer'

const STICK_PX = 80

interface ItemProps {
  item: GroupItem
  group: GroupView
  bots: readonly BotView[]
  onRetry: (eventId: string) => void
  onKeepGoing: (discussionEventId: string) => void
}

function UserBubble({ item, onRetry }: { item: Extract<GroupItem, { kind: 'user' }>; onRetry: (eventId: string) => void }) {
  const fromOther = item.author !== 'you'
  return (
    <div className="flex max-w-[80%] flex-col items-end gap-1 self-end">
      {fromOther && <span className="text-xs text-muted-foreground">{item.author}</span>}
      <div className="rounded-[16px_16px_4px_16px] bg-raised px-3.5 py-2.5 whitespace-pre-wrap text-foreground">{item.text}</div>
      {item.status === 'unknown' && (
        <p className="text-xs text-muted-foreground">
          Delivery uncertain.{' '}
          <button type="button" className="underline" onClick={() => onRetry(item.eventId)}>Retry</button>
        </p>
      )}
      {item.status === 'refused' && (
        <p className="text-xs text-muted-foreground">
          {item.error ?? 'Not sent'}.{' '}
          <button type="button" className="underline" onClick={() => onRetry(item.eventId)}>Retry</button>
        </p>
      )}
    </div>
  )
}

function MemberBubble({ item, group, bots }: { item: Extract<GroupItem, { kind: 'member' }>; group: GroupView; bots: readonly BotView[] }) {
  const member: GroupMemberView | undefined = group.members.find(m => m.memberId === item.memberId)
  const bot = bots.find(b => b.name === member?.profile)
  return (
    <div data-testid="member-message" className="flex items-start gap-2.5">
      {/* Message rows never show live status; the live rows below do. */}
      {bot && <CrewAvatar bot={{ ...bot, status: 'idle' }} size={30} decorative />}
      <div className="min-w-0 flex-1 text-sm">
        <div className="flex items-baseline gap-1.5">
          <span className="font-semibold">{memberTitle(group, bots, item.memberId)}</span>
          {member && <span className="text-xs text-muted-foreground">{`@${member.handle}`}</span>}
        </div>
        <Markdown text={markMentions(item.text, group.members)} />
      </div>
    </div>
  )
}

function Item({ item, group, bots, onRetry, onKeepGoing }: ItemProps): ReactNode {
  switch (item.kind) {
    case 'user':
      return (
        <>
          {item.newTopic && <div role="separator" className="flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />New topic<span className="h-px flex-1 bg-border" /></div>}
          <UserBubble item={item} onRetry={onRetry} />
        </>
      )
    case 'member':
      return <MemberBubble item={item} group={group} bots={bots} />
    case 'notice':
      return <NoticeRow item={item} onKeepGoing={onKeepGoing} />
  }
}

interface GroupMessageListProps {
  items: readonly GroupItem[]
  group: GroupView
  bots: readonly BotView[]
  cut: boolean
  onRetry: (eventId: string) => void
  onKeepGoing: (discussionEventId: string) => void
  /** Live rows and turn actions, shown after the last message. */
  footer?: ReactNode
}

/** The group transcript. Follows new content unless the reader scrolled up. */
export function GroupMessageList({ items, group, bots, cut, onRetry, onKeepGoing, footer }: GroupMessageListProps) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, footer])

  return (
    <div
      ref={ref}
      data-testid="transcript"
      onScroll={e => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
      }}
      className="min-h-0 flex-1 overflow-y-auto py-6"
    >
      <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-6">
        {cut && <p className="text-center text-xs text-muted-foreground">Older messages are in Hermes.</p>}
        {items.map(item => <Item key={item.key} item={item} group={group} bots={bots} onRetry={onRetry} onKeepGoing={onKeepGoing} />)}
        {footer}
      </div>
    </div>
  )
}
