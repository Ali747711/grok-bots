import { ArrowUp } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { BotView, GroupView } from '@/state/types'

import { MentionPopover, optionId } from './MentionPopover'
import type { MentionOption } from './MentionPopover'
import { mentionQueryAt, whoWillAnswer } from './mentions'

interface GroupComposerProps {
  view: GroupView
  /** Bots by member profile; a deleted member's bot is missing and is listed by handle only. */
  members: readonly BotView[]
  titleOf: (memberId: string) => string
  /** No user message in this topic yet. */
  firstInTopic: boolean
  running: boolean
  disabledReason: string | null
  onSend: (text: string, opts: { newTopic: boolean }) => void
  onStop: () => void
  /** The current topic is too long for Hermes: the next message opens a new one. */
  topicFull?: boolean
  /** Controlled New topic state; without them the composer keeps its own. */
  armed?: boolean
  onArmed?: (armed: boolean) => void
}

const LIST_ID = 'group-mentions'

function optionsFor(view: GroupView, bots: readonly BotView[], titleOf: (id: string) => string, query: string): MentionOption[] {
  const q = query.toLowerCase()
  const people = view.members
    .map(m => ({ handle: m.handle, title: titleOf(m.memberId), bot: bots.find(b => b.name === m.profile) ?? null }))
    .filter(o => o.handle.toLowerCase().startsWith(q) || o.title.toLowerCase().startsWith(q))
  const everyone = 'everyone'.startsWith(q) || 'all'.startsWith(q)
  return everyone ? [...people, { handle: 'everyone', title: 'Everyone', bot: null }] : people
}

/** Message box for a group: Enter sends, "@" lists members, a line says who will answer, New topic starts a thread. */
export function GroupComposer({ view, members, titleOf, firstInTopic, running, disabledReason, onSend, onStop, topicFull = false, armed: armedProp, onArmed }: GroupComposerProps) {
  const [text, setText] = useState('')
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [innerArmed, setInnerArmed] = useState(false)
  const armed = armedProp ?? innerArmed
  const setArmed = onArmed ?? setInnerArmed
  const ref = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const disabled = disabledReason !== null

  const at = disabled ? null : mentionQueryAt(text, caret)
  const options = at && at.start !== dismissed ? optionsFor(view, members, titleOf, at.query) : []
  const open = options.length > 0
  const current = Math.min(active, Math.max(0, options.length - 1))

  // Escape only silences the token it was pressed in: once the caret is elsewhere, or the "@" is gone, the list may reopen.
  const tokenStart = at?.start ?? null
  useEffect(() => {
    if (dismissed !== null && tokenStart !== dismissed) setDismissed(null)
  }, [dismissed, tokenStart])

  useLayoutEffect(() => {
    if (pendingCaret.current !== null && ref.current) {
      ref.current.setSelectionRange(pendingCaret.current, pendingCaret.current)
      pendingCaret.current = null
    }
  })

  const syncCaret = () => setCaret(ref.current?.selectionStart ?? text.length)
  const insert = (option: MentionOption) => {
    if (!at) return
    const token = `@${option.handle} `
    setText(text.slice(0, at.start) + token + text.slice(caret))
    pendingCaret.current = at.start + token.length
    setCaret(at.start + token.length)
    setActive(0)
  }
  const submit = () => {
    const value = text.trim()
    if (!value || disabled || running) return
    onSend(value, { newTopic: armed })
    setText('')
    setCaret(0)
    setArmed(false)
    setDismissed(null)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((current + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insert(options[current]!)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setDismissed(at!.start)
        return
      }
    }
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  const line = whoWillAnswer({ text, members: view.members, routing: view.routing, leadMemberId: view.leadMemberId, firstInTopic: firstInTopic || armed || topicFull, titleOf })
  const fresh = topicFull && !armed

  return (
    <div className="px-6 pt-3 pb-5">
      <div className="mx-auto max-w-[720px]">
        {disabledReason && <p role="status" className="mb-1.5 text-xs text-muted-foreground">{disabledReason}</p>}
        <div className="relative">
          {open && <MentionPopover id={LIST_ID} options={options} active={current} onPick={insert} />}
          <div className="flex items-end gap-2.5 rounded-3xl border border-border bg-muted px-3 py-2">
            <Textarea
              ref={ref}
              value={text}
              disabled={disabled}
              onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); setActive(0) }}
              onKeyDown={onKeyDown}
              onKeyUp={syncCaret}
              onClick={syncCaret}
              placeholder="Message the group. Type @ to mention a bot"
              rows={1}
              aria-label="Message"
              aria-controls={open ? LIST_ID : undefined}
              aria-autocomplete="list"
              aria-activedescendant={open ? optionId(LIST_ID, current) : undefined}
              className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
            />
            {running ? (
              <Button type="button" onClick={onStop} className="rounded-full bg-raised text-foreground hover:bg-hover">Stop</Button>
            ) : (
              <Button type="button" size="icon" aria-label="Send" disabled={disabled || !text.trim()} onClick={submit} className="rounded-full"><ArrowUp /></Button>
            )}
          </div>
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <p data-testid="who-will-answer" className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{armed ? `New topic · ${line}` : fresh ? `New topic · ${line} — long topics start fresh (Hermes keeps 24 messages per topic)` : line}</p>
          <Button type="button" size="xs" variant={armed ? 'default' : 'outline'} aria-pressed={armed} disabled={disabled} onClick={() => setArmed(!armed)} className="rounded-full">
            New topic
          </Button>
        </div>
      </div>
    </div>
  )
}
