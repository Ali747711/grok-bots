import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { COMPOSER_CAPTION, COMPOSER_FIELD, COMPOSER_WELL, ComposerAction, useSlashFocus } from '@/features/chat/Composer'
import { draftKey, useDraft } from '@/features/chat/draft-store'
import { cn } from '@/lib/utils'
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
const TOPIC = 'flex h-7 shrink-0 items-center rounded-full px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function optionsFor(view: GroupView, bots: readonly BotView[], titleOf: (id: string) => string, query: string): MentionOption[] {
  const q = query.toLowerCase()
  const people = view.members
    .map(m => ({ handle: m.handle, title: titleOf(m.memberId), bot: bots.find(b => b.name === m.profile) ?? null }))
    .filter(o => o.handle.toLowerCase().startsWith(q) || o.title.toLowerCase().startsWith(q))
  const everyone = 'everyone'.startsWith(q) || 'all'.startsWith(q)
  return everyone ? [...people, { handle: 'everyone', title: 'Everyone', bot: null }] : people
}

/** Starts a new thread with the next message. A quiet pill in the well's action row; pressed while armed. */
function TopicToggle({ armed, disabled, onChange }: { armed: boolean; disabled: boolean; onChange: (armed: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={armed}
      disabled={disabled}
      onClick={() => onChange(!armed)}
      className={cn(TOPIC, armed ? 'bg-raised text-foreground' : 'text-muted-foreground hover:bg-hover hover:text-foreground')}
    >
      New topic
    </button>
  )
}

/**
 * Message box for a group, in the bot composer's shape: the well with the field, New topic and the round
 * Send / Stop, and a caption underneath that says who will answer. Enter sends, "@" lists members, `/` focuses it.
 */
export function GroupComposer({ view, members, titleOf, firstInTopic, running, disabledReason, onSend, onStop, topicFull = false, armed: armedProp, onArmed }: GroupComposerProps) {
  // The unsent text outlives this view (another page, another group) for the life of the tab.
  const [text, setText] = useDraft(draftKey.group(view.id))
  const [caret, setCaret] = useState(0)
  const [active, setActive] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [innerArmed, setInnerArmed] = useState(false)
  const armed = armedProp ?? innerArmed
  const setArmed = onArmed ?? setInnerArmed
  const ref = useRef<HTMLTextAreaElement>(null)
  const pendingCaret = useRef<number | null>(null)
  const disabled = disabledReason !== null

  useSlashFocus(ref)

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

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    submit()
  }
  const stop = () => {
    // Stop goes away when the turn ends: keep focus in the box.
    ref.current?.focus()
    onStop()
  }

  const line = whoWillAnswer({ text, members: view.members, routing: view.routing, leadMemberId: view.leadMemberId, firstInTopic: firstInTopic || armed || topicFull, titleOf })
  const fresh = topicFull && !armed

  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="relative mx-auto max-w-[720px]">
        {open && <MentionPopover id={LIST_ID} options={options} active={current} onPick={insert} />}
        <form onSubmit={onSubmit} className={COMPOSER_WELL}>
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={e => { setText(e.target.value); setCaret(e.target.selectionStart); setActive(0) }}
            onKeyDown={onKeyDown}
            onKeyUp={syncCaret}
            onClick={syncCaret}
            placeholder="Message the group. Type @ to mention a bot"
            aria-label="Message"
            aria-controls={open ? LIST_ID : undefined}
            aria-autocomplete="list"
            aria-activedescendant={open ? optionId(LIST_ID, current) : undefined}
            className={COMPOSER_FIELD}
          />
          <div className="flex items-center justify-between gap-2 pl-1">
            <TopicToggle armed={armed} disabled={disabled} onChange={setArmed} />
            <ComposerAction running={running} canSend={!disabled && text.trim().length > 0} stopDisabled={false} onStop={stop} />
          </div>
        </form>
        <div className={COMPOSER_CAPTION}>
          {disabledReason && <p role="status" className="text-foreground">{disabledReason}</p>}
          <p data-testid="who-will-answer" className="truncate">{armed ? `New topic · ${line}` : fresh ? `New topic · ${line} — long topics start fresh (Hermes keeps 24 messages per topic)` : line}</p>
        </div>
      </div>
    </div>
  )
}
