import { useState, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

interface ComposerProps {
  onSend: (text: string) => void
  onStop: () => void
  running: boolean
  disabledReason: string | null
  /** Stop needs a live connection even when sending is blocked for another reason. */
  stopDisabled?: boolean
}

/** Message box: Enter sends, Shift+Enter adds a line, Stop replaces Send while the bot is running. */
export function Composer({ onSend, onStop, running, disabledReason, stopDisabled = false }: ComposerProps) {
  const [text, setText] = useState('')
  const disabled = disabledReason !== null

  const submit = () => {
    const value = text.trim()
    if (!value || disabled) return
    onSend(value)
    setText('')
  }
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  return (
    <div className="px-6 pt-3 pb-5">
      <div className="mx-auto max-w-[720px]">
        {disabledReason && <p role="status" className="mb-1.5 text-xs text-muted-foreground">{disabledReason}</p>}
        <div className="flex items-end gap-2.5 rounded-[14px] border border-border bg-card px-3 py-2.5">
          <Textarea
            value={text}
            disabled={disabled}
            onChange={e => setText(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Message"
            rows={1}
            aria-label="Message"
            className="max-h-40 min-h-9 flex-1 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
          />
          {running ? (
            <Button type="button" variant="outline" disabled={stopDisabled} onClick={onStop}>Stop</Button>
          ) : (
            <Button type="button" disabled={disabled || !text.trim()} onClick={submit}>Send</Button>
          )}
        </div>
      </div>
    </div>
  )
}
