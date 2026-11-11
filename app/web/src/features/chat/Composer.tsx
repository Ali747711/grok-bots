import { type FormEvent, type KeyboardEvent, type RefObject, useRef } from 'react'

import { ArrowUp, Square } from 'lucide-react'

import { IconButton } from '@/components/console/icon-button'
import { Kbd } from '@/components/console/kbd'
import { shouldIgnoreShortcut, useWindowKeydown } from '@/hooks/use-window-keydown'
import { cn } from '@/lib/utils'

import { composerCaption } from './composer-caption'
import { useDraft } from './draft-store'

interface ComposerProps {
  /** Where the unsent text is kept (`bot:<handle>`), so it survives leaving the conversation. */
  draftKey: string
  onSend: (text: string) => void
  onStop: () => void
  /** The chat session has a turn running: Stop replaces Send. */
  running: boolean
  disabledReason: string | null
  /** A request for this chat is open in the cards above. */
  waitingAbove: boolean
  /** A sent message waits behind the running turn. */
  queued: boolean
  /** Stop needs a live connection even when sending is blocked for another reason. */
  stopDisabled?: boolean
}

/** Safari reports the Enter that commits an IME composition with this code. */
const IME_KEY_CODE = 229
const ROUND = 'size-9 rounded-full'
/** The well that holds the message field and its action row. Shared with the group composer. */
export const COMPOSER_WELL = 'relative z-10 rounded-[26px] border border-border bg-background p-1.5 transition-colors focus-within:border-ring'
export const COMPOSER_FIELD = 'block field-sizing-content max-h-40 min-h-10 w-full resize-none bg-transparent px-2.5 py-2 text-sm leading-relaxed outline-none placeholder:text-faint disabled:cursor-not-allowed disabled:opacity-50'
/** The drawer tucked under the well: it starts behind the well's rounded bottom edge. */
export const COMPOSER_CAPTION = '-mt-[26px] rounded-b-[26px] border border-t-0 border-border bg-raised/50 px-4 pt-[34px] pb-2 text-center text-xs font-medium text-muted-foreground'
const HINTS = (
  <p aria-hidden="true" className="flex items-center gap-1.5 text-xs font-medium text-faint">
    <Kbd>↵</Kbd> send
    <Kbd className="ml-1.5">⇧↵</Kbd> new line
  </p>
)

/** `/` anywhere outside a field, a popup and the bot's screen puts the caret in the message box. */
export function useSlashFocus(field: RefObject<HTMLTextAreaElement | null>): void {
  useWindowKeydown(event => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
    if (shouldIgnoreShortcut(event) || field.current === null || field.current.disabled) return
    event.preventDefault()
    field.current.focus()
  })
}

interface ActionProps {
  running: boolean
  canSend: boolean
  stopDisabled: boolean
  onStop: () => void
}

/** The round button at the end of the well: Stop while the turn runs, Send (the form's submit) otherwise. */
export function ComposerAction({ running, canSend, stopDisabled, onStop }: ActionProps) {
  if (running) {
    return (
      <IconButton label="Stop" disabled={stopDisabled} onClick={onStop} className={cn(ROUND, 'bg-raised text-foreground hover:bg-control')}>
        <Square className="size-3" fill="currentColor" aria-hidden="true" />
      </IconButton>
    )
  }
  return (
    <IconButton
      type="submit"
      label="Send"
      disabled={!canSend}
      className={cn(ROUND, canSend ? 'bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground' : 'bg-raised text-faint')}
    >
      <ArrowUp className="size-4" strokeWidth={2.5} aria-hidden="true" />
    </IconButton>
  )
}

/**
 * Message box (crew-bots composer): a well with a growing textarea, a round Send, a round Stop while the
 * turn runs, and one caption tucked underneath. Enter sends, Shift+Enter adds a line, `/` focuses it.
 */
export function Composer({ draftKey, onSend, onStop, running, disabledReason, waitingAbove, queued, stopDisabled = false }: ComposerProps) {
  const [text, setText] = useDraft(draftKey)
  const field = useRef<HTMLTextAreaElement>(null)
  const disabled = disabledReason !== null
  const canSend = !disabled && text.trim().length > 0
  const caption = composerCaption({ disabledReason, waitingAbove, queued })

  useSlashFocus(field)

  const submit = () => {
    const value = text.trim()
    if (!value || disabled) return
    onSend(value)
    setText('')
  }
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    submit()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends; Shift+Enter and an IME composition keep their own meaning.
    if (event.key !== 'Enter' || event.shiftKey) return
    if (event.nativeEvent.isComposing || event.keyCode === IME_KEY_CODE) return
    event.preventDefault()
    submit()
  }
  const stop = () => {
    // Stop goes away when the turn ends: keep focus in the box.
    field.current?.focus()
    onStop()
  }

  return (
    <div className="shrink-0 px-4 pb-4">
      <div className="mx-auto max-w-[720px]">
        <form onSubmit={onSubmit} className={COMPOSER_WELL}>
          <textarea
            ref={field}
            rows={1}
            value={text}
            disabled={disabled}
            onChange={event => setText(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message"
            aria-label="Message"
            className={COMPOSER_FIELD}
          />
          <div className="flex items-center justify-between pl-2.5">
            {HINTS}
            <ComposerAction running={running} canSend={canSend} stopDisabled={stopDisabled} onStop={stop} />
          </div>
        </form>
        {caption && <p role="status" className={COMPOSER_CAPTION}>{caption}</p>}
      </div>
    </div>
  )
}
