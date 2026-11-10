import { useEffect, useRef } from 'react'

import type { ChatItem } from '@/chat/types'

import { Markdown } from './Markdown'
import { WorkBlock } from './WorkBlock'

const STICK_PX = 80

function Item({ item, onRetry }: { item: ChatItem; onRetry?: (submissionId: string) => void }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="flex max-w-[80%] flex-col items-end gap-1 self-end">
          <div className="rounded-[16px_16px_4px_16px] bg-raised px-3.5 py-2.5 whitespace-pre-wrap text-foreground">{item.text}</div>
          {item.delivery === 'checking' && <p className="text-xs text-muted-foreground">Delivery uncertain — checking…</p>}
          {item.delivery === 'not_sent' && (
            <p className="text-xs text-muted-foreground">
              {item.reason ?? 'Not sent'}.{' '}
              {item.submissionId && onRetry && (
                <button type="button" className="underline" onClick={() => onRetry(item.submissionId!)}>Retry</button>
              )}
            </p>
          )}
        </div>
      )
    case 'assistant':
      return <div className="text-sm leading-relaxed"><Markdown text={item.text} /></div>
    case 'work':
      return <WorkBlock item={item} />
    case 'notice':
      return <p className="mx-auto rounded-full bg-muted px-3 py-1 text-center text-xs text-muted-foreground">{item.text}</p>
  }
}

/** The transcript. Follows new content unless the reader scrolled up. */
export function MessageList({ items, onRetry }: { items: readonly ChatItem[]; onRetry?: (submissionId: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  useEffect(() => {
    const el = ref.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [items])

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
        {items.map(item => <Item key={item.id} item={item} onRetry={onRetry} />)}
      </div>
    </div>
  )
}
