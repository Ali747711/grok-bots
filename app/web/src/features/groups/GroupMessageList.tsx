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
const CAPTION = 'pr-2.5 text-[11px] font-medium text-faint'
const RETRY = 'rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring'

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
    <div className="flex max-w-[85%] flex-col items-end gap-1 self-end">
      {fromOther && <span className={CAPTION}>{item.author}</span>}
      <div className="rounded-2xl bg-raised px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">{item.text}</div>
      {item.status === 'unknown' && (
        <p className={CAPTION}>
          Delivery uncertain.{' '}
          <button type="button" className={RETRY} onClick={() => onRetry(item.eventId)}>Retry</button>
        </p>
      )}
      {item.status === 'refused' && (
        <p className={CAPTION}>
          {item.error ?? 'Not sent'}.{' '}
          <button type="button" className={RETRY} onClick={() => onRetry(item.eventId)}>Retry</button>
        </p>
      )}
    </div>
  )
}

function MemberMessage({ item, group, bots }: { item: Extract<GroupItem, { kind: 'member' }>; group: GroupView; bots: readonly BotView[] }) {
  const member: GroupMemberView | undefined = group.members.find(m => m.memberId === item.memberId)
  const bot = bots.find(b => b.name === member?.profile)
  return (
    <div data-testid="member-message" className="flex max-w-[94%] items-start gap-2.5">
      {/* Message rows never show live status; the live rows below do. */}
      {bot ? <CrewAvatar bot={{ ...bot, status: 'idle' }} size={28} decorative /> : <span aria-hidden="true" className="size-7 flex-none rounded-[30%] bg-control" />}
      <div className="min-w-0 flex-1 text-sm leading-relaxed">
        <div className="flex items-baseline gap-1.5 leading-5">
          <span className="text-[13px] font-semibold">{memberTitle(group, bots, item.memberId)}</span>
          {member && <span className="text-xs font-medium text-faint">{`@${member.handle}`}</span>}
        </div>
        <Markdown text={markMentions(item.text, group.members)} />
      </div>
    </div>
  )
}

function TopicBreak() {
  return (
    <div role="separator" className="flex items-center gap-3 text-[11px] font-medium text-faint">
      <span className="h-px flex-1 bg-border" />New topic<span className="h-px flex-1 bg-border" />
    </div>
  )
}

function Item({ item, group, bots, onRetry, onKeepGoing }: ItemProps): ReactNode {
  switch (item.kind) {
    case 'user':
      return (
        <>
          {item.newTopic && <TopicBreak />}
          <UserBubble item={item} onRetry={onRetry} />
        </>
      )
    case 'member':
      return <MemberMessage item={item} group={group} bots={bots} />
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
  /** Shown above any notices while nobody has written a message. */
  empty?: ReactNode
}

/** The group transcript, in the bot transcript's layout. Follows new content unless the reader scrolled up. */
export function GroupMessageList({ items, group, bots, cut, onRetry, onKeepGoing, footer, empty }: GroupMessageListProps) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items, footer])

  return (
    <div
      ref={ref}
      role="log"
      aria-label="Messages"
      data-testid="transcript"
      onScroll={e => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
      }}
      className="flex min-h-0 flex-1 scroll-thin flex-col overflow-y-auto px-4 py-5"
    >
      <div className="mx-auto flex w-full max-w-[720px] flex-1 flex-col gap-4">
        {cut && <p className="text-center text-xs font-medium text-faint">Older messages are in Hermes.</p>}
        {/* A new group already holds a notice ("Replies set to Auto"), so "empty" means no message yet. */}
        {items.every(item => item.kind === 'notice') && empty}
        {items.map(item => <Item key={item.key} item={item} group={group} bots={bots} onRetry={onRetry} onKeepGoing={onKeepGoing} />)}
        {footer}
      </div>
    </div>
  )
}
