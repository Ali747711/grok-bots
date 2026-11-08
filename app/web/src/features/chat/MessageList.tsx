import { useEffect, useRef } from 'react'

import type { ChatItem } from '@/chat/types'

import { Markdown } from './Markdown'
import { WorkBlock } from './WorkBlock'

const STICK_PX = 80

function Item({ item }: { item: ChatItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="max-w-[80%] self-end rounded-[16px_16px_4px_16px] bg-primary px-3.5 py-2.5 whitespace-pre-wrap text-primary-foreground">
          {item.text}
        </div>
      )
    case 'assistant':
      return <div className="text-sm leading-relaxed"><Markdown text={item.text} /></div>
    case 'work':
      return <WorkBlock item={item} />
    case 'notice':
      return <p className="text-center text-xs text-muted-foreground">{item.text}</p>
  }
}

/** The transcript. Follows new content unless the reader scrolled up. */
export function MessageList({ items }: { items: readonly ChatItem[] }) {
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
        {items.map(item => <Item key={item.id} item={item} />)}
      </div>
    </div>
  )
}
