import { type ReactNode, useEffect, useRef } from 'react'

import type { ChatItem } from '@/chat/types'

import { Markdown } from './Markdown'
import { RunCard } from './RunCard'

const STICK_PX = 80
const CAPTION = 'pr-2.5 text-[11px] font-medium text-faint'

type UserItem = Extract<ChatItem, { kind: 'user' }>

function UserBubble({ item, onRetry }: { item: UserItem; onRetry?: (submissionId: string) => void }) {
  const { submissionId } = item
  return (
    <div className="flex max-w-[85%] flex-col items-end gap-1 self-end">
      <div className="rounded-2xl bg-raised px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-foreground">{item.text}</div>
      {item.delivery === 'checking' && <p className={CAPTION}>Delivery uncertain — checking…</p>}
      {item.delivery === 'not_sent' && (
        <p className={CAPTION}>
          {item.reason ?? 'Not sent'}.{' '}
          {submissionId && onRetry && (
            <button type="button" className="rounded-sm text-foreground underline underline-offset-2 outline-none focus-visible:ring-3 focus-visible:ring-ring" onClick={() => onRetry(submissionId)}>Retry</button>
          )}
        </p>
      )}
      {item.queued && !item.delivery && <p className={CAPTION}>Queued</p>}
    </div>
  )
}

function Item({ item, onRetry }: { item: ChatItem; onRetry?: (submissionId: string) => void }) {
  switch (item.kind) {
    case 'user':
      return <UserBubble item={item} onRetry={onRetry} />
    case 'assistant':
      return <div className="max-w-[94%] text-sm leading-relaxed"><Markdown text={item.text} /></div>
    case 'work':
      return <RunCard item={item} />
    case 'notice':
      return <p className="text-center text-xs font-medium text-faint">{item.text}</p>
  }
}

interface MessageListProps {
  items: readonly ChatItem[]
  onRetry?: (submissionId: string) => void
  /** Shown in place of the messages while there are none. */
  empty?: ReactNode
}

/** The transcript. Follows new content unless the reader scrolled up. */
export function MessageList({ items, onRetry, empty }: MessageListProps) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items])

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
        {items.length === 0 && empty}
        {items.map(item => <Item key={item.id} item={item} onRetry={onRetry} />)}
      </div>
    </div>
  )
}
