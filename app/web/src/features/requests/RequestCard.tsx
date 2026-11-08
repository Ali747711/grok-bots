import { useState, type KeyboardEvent } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PendingView } from '@/state/types'

import type { AnswerBody } from './answer-request'
import { choiceCopy } from './choice-copy'

interface RequestCardProps {
  entry: PendingView
  /** Sends the answer; resolves null on success or a message to show. */
  onAnswer: (entry: PendingView, body: AnswerBody) => Promise<string | null>
}

const FAILURES: Record<string, string> = {
  not_connected: 'Hermes was offline',
  stale_generation: 'This request is no longer current'
}
const SCOPED = new Set(['session', 'always'])
/** Same limit the server enforces on answers. */
const ANSWER_MAX = 4000
const COUNT_FROM = 3800

/** Enter that finishes an IME syllable (Korean, Japanese, Chinese) must not submit. */
const isSubmitKey = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229

/** The exact operation being approved, in full. Falls back to the short summary for an older server. */
function ApprovalDetail({ entry }: { entry: PendingView }) {
  if (entry.command === undefined && entry.description === undefined) return <p className="mb-2 font-medium break-words">{entry.summary}</p>
  return (
    <div className="mb-2 space-y-2">
      {entry.description && <p className="font-medium break-words whitespace-pre-wrap">{entry.description}</p>}
      {entry.command && (
        <pre data-testid="approval-command" className="max-h-[40vh] overflow-auto rounded-md border border-border bg-card p-2 font-mono text-xs break-all whitespace-pre-wrap">
          {entry.command}
        </pre>
      )}
      {entry.detailTruncated && <p className="text-xs font-medium text-red-600 dark:text-red-400">This command is too long to show in full. Review it in the Hermes app.</p>}
    </div>
  )
}

function ApprovalControls({ entry, disabled, send }: { entry: PendingView; disabled: boolean; send: (b: AnswerBody) => Promise<string | null> }) {
  // Never offer an allow choice for text the user cannot see in full.
  const choices = (entry.choices ?? []).filter(c => !entry.detailTruncated || c === 'deny')
  return (
    <>
      <div className="flex flex-wrap gap-2">
        {choices.map(choice => {
          const { label, hint } = choiceCopy(choice)
          return (
            <Button
              key={choice}
              type="button"
              size="sm"
              variant={choice === 'deny' ? 'destructive' : choice === 'once' ? 'default' : 'outline'}
              title={hint || undefined}
              disabled={disabled}
              onClick={() => void send({ choice })}
            >
              {label}
            </Button>
          )
        })}
      </div>
      {choices.filter(c => SCOPED.has(c)).map(c => (
        <p key={c} className="mt-2 text-xs text-muted-foreground">{choiceCopy(c).label} — {choiceCopy(c).hint}</p>
      ))}
    </>
  )
}

function ClarifyControls({ entry, disabled, retry, send }: { entry: PendingView; disabled: boolean; retry: boolean; send: (b: AnswerBody) => Promise<string | null> }) {
  const [text, setText] = useState('')
  // The draft is kept until Crew accepts the answer, so a failure never loses it.
  const submit = async () => {
    if (!text.trim()) return
    if ((await send({ answer: text.trim() })) === null) setText('')
  }
  return (
    <div className="space-y-2">
      {entry.choices && entry.choices.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {entry.choices.map(c => (
            <Button key={c} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void send({ answer: c })}>{c}</Button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          aria-label="Your answer"
          value={text}
          disabled={disabled}
          maxLength={ANSWER_MAX}
          onChange={e => setText(e.target.value.slice(0, ANSWER_MAX))}
          onKeyDown={e => { if (isSubmitKey(e)) void submit() }}
        />
        <Button type="button" size="sm" disabled={disabled || !text.trim()} onClick={() => void submit()}>{retry ? 'Try again' : 'Send'}</Button>
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => void send({ answer: '' })}>Skip</Button>
      </div>
      {text.length >= COUNT_FROM && <p className="text-right text-xs text-muted-foreground">{text.length.toLocaleString('en-US')} / {ANSWER_MAX.toLocaleString('en-US')}</p>}
    </div>
  )
}

function SecretControls({ entry, disabled, retry, send }: { entry: PendingView; disabled: boolean; retry: boolean; send: (b: AnswerBody) => Promise<string | null> }) {
  // Local state only: cleared the moment it is submitted, whatever the outcome.
  const [value, setValue] = useState('')
  const inputId = `secret-${entry.id}`
  const label = entry.kind === 'sudo' ? `Password needed to run: ${entry.summary}` : entry.summary
  const submit = () => {
    if (!value) return
    const submitted = value
    setValue('')
    void send({ value: submitted })
  }
  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm">{label}</label>
      <div className="flex gap-2">
        <Input
          id={inputId}
          type="password"
          autoComplete="off"
          value={value}
          disabled={disabled}
          onChange={e => setValue(e.target.value)}
          onKeyDown={e => { if (isSubmitKey(e)) submit() }}
        />
        <Button type="button" size="sm" disabled={disabled || !value} onClick={submit}>{retry ? 'Try again' : 'Send'}</Button>
      </div>
    </div>
  )
}

/** One request waiting for the user: approval, question, or secret/sudo prompt. Shows only what Hermes sent. */
export function RequestCard({ entry, onAnswer }: RequestCardProps) {
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const disabled = sending || entry.state === 'answering'
  const retry = entry.state === 'failed'
  const secret = entry.kind === 'secret' || entry.kind === 'sudo'

  /** Resolves null when Crew accepted the answer, otherwise the message shown on the card. */
  const send = async (body: AnswerBody): Promise<string | null> => {
    setSending(true)
    setMessage(null)
    try {
      const result = await onAnswer(entry, body)
      setMessage(result)
      return result
    } finally {
      setSending(false)
    }
  }

  return (
    <div data-testid="request-card" className="rounded-xl border border-amber-300 bg-amber-50 p-3.5 text-sm dark:border-amber-800 dark:bg-amber-950">
      {entry.kind === 'approval' && <ApprovalDetail entry={entry} />}
      {(entry.kind === 'clarify' || (secret && !entry.answerable)) && <p className="mb-2 font-medium break-words">{entry.summary}</p>}
      {!entry.answerable ? (
        <p className="text-xs text-muted-foreground">Answer this in the app that asked</p>
      ) : (
        <>
          {entry.kind === 'approval' && <ApprovalControls entry={entry} disabled={disabled} send={send} />}
          {entry.kind === 'clarify' && <ClarifyControls entry={entry} disabled={disabled} retry={retry} send={send} />}
          {secret && <SecretControls entry={entry} disabled={disabled} retry={retry} send={send} />}
        </>
      )}
      {disabled && <p role="status" className="mt-2 text-xs text-muted-foreground">Sending…</p>}
      {retry && entry.answerable && <p className="mt-2 text-xs text-red-600 dark:text-red-400">Couldn’t send: {FAILURES[entry.error ?? ''] ?? entry.error ?? 'unknown error'}. Try again.</p>}
      {message && <p className="mt-2 text-xs text-muted-foreground">{message}</p>}
    </div>
  )
}
