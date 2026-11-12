import { type FocusEvent, type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from 'react'

import { KeyRound, MessageCircleQuestion, ShieldAlert } from 'lucide-react'

import { IndeterminateBar } from '@/components/console/motion-bits'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PendingView } from '@/state/types'

import type { AnswerBody } from './answer-request'
import { choiceCopy } from './choice-copy'
import { hasHidden, RevealHidden } from './reveal-hidden'

interface RequestCardProps {
  entry: PendingView
  /** Sends the answer; resolves null on success or a message to show. */
  onAnswer: (entry: PendingView, body: AnswerBody) => Promise<string | null>
  /** Shown in the approval title; falls back to the profile handle. */
  botTitle?: string
  /**
   * Replaces the card's own heading (label, approval title, bare summary), for a page whose header already
   * names the bot and holds the summary. The full command, warnings and controls always stay.
   */
  header?: ReactNode
}

const FAILURES: Record<string, string> = {
  not_connected: 'Hermes was offline',
  stale_generation: 'This request is no longer current'
}
const SECONDARY = 'text-muted-foreground'
const WARNING = 'text-xs font-medium text-destructive'
const SUMMARY = 'mb-2 text-[13px] font-semibold break-words'
const KIND_ICON = { approval: ShieldAlert, clarify: MessageCircleQuestion, secret: KeyRound, sudo: KeyRound }
const INPUT = 'border-border bg-control text-foreground placeholder:text-muted-foreground dark:bg-control'
const SCOPED = new Set(['session', 'always'])
/** Same limit the server enforces on answers. */
const ANSWER_MAX = 4000
const COUNT_FROM = 3800

/** Enter that finishes an IME syllable (Korean, Japanese, Chinese) must not submit. */
const isSubmitKey = (e: KeyboardEvent<HTMLInputElement>) => e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229

/** The exact operation being approved, in full. Falls back to the short summary for an older server. */
function ApprovalDetail({ entry, bare }: { entry: PendingView; bare: boolean }) {
  if (entry.command === undefined && entry.description === undefined) return bare ? null : <p className={SUMMARY}>{entry.summary}</p>
  return (
    <div className="mb-2 space-y-2">
      {(hasHidden(entry.command) || hasHidden(entry.description)) && <p className={WARNING}>This command contains hidden characters.</p>}
      {entry.description && <p className="text-[13px] font-medium break-words whitespace-pre-wrap text-muted-foreground"><RevealHidden text={entry.description} /></p>}
      {entry.command && (
        <pre data-testid="approval-command" className="max-h-[40vh] overflow-auto rounded-lg bg-control p-2.5 font-mono text-xs break-all whitespace-pre-wrap">
          <RevealHidden text={entry.command} />
        </pre>
      )}
      {entry.app?.argsTruncated && <p className={WARNING}>Hermes shows only the start of this request.</p>}
      {entry.detailTruncated && <p className={WARNING}>This command is too long to show in full. Review it in the Hermes app.</p>}
    </div>
  )
}

function ApprovalControls({ entry, disabled, send }: { entry: PendingView; disabled: boolean; send: (b: AnswerBody) => Promise<string | null> }) {
  // Never offer an allow choice for text the user cannot see in full.
  // An app prompt keeps once/deny only: "session" and "always" would allow later app actions silently.
  const choices = (entry.choices ?? [])
    .filter(c => !entry.app || c === 'once' || c === 'deny')
    .filter(c => !entry.detailTruncated || c === 'deny')
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
              variant={choice === 'once' ? 'default' : 'outline'}
              data-emphasis={choice === 'once' ? 'primary' : undefined}
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
        <p key={c} className={`mt-2 text-xs ${SECONDARY}`}>{choiceCopy(c).label} — {choiceCopy(c).hint}</p>
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
          className={INPUT}
          value={text}
          disabled={disabled}
          maxLength={ANSWER_MAX}
          onChange={e => setText(e.target.value.slice(0, ANSWER_MAX))}
          onKeyDown={e => { if (isSubmitKey(e)) void submit() }}
        />
        <Button type="button" size="sm" disabled={disabled || !text.trim()} onClick={() => void submit()}>{retry ? 'Try again' : 'Send'}</Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void send({ answer: '' })}>Skip</Button>
      </div>
      {text.length >= COUNT_FROM && <p className={`text-right text-xs ${SECONDARY}`}>{text.length.toLocaleString('en-US')} / {ANSWER_MAX.toLocaleString('en-US')}</p>}
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
          className={INPUT}
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

/** The card's own heading: what kind of request it is and, for an approval, whose. */
function CardHeading({ entry, botTitle }: { entry: PendingView; botTitle?: string }) {
  const Icon = KIND_ICON[entry.kind]
  return (
    <div className="mb-2 flex items-center gap-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-control text-foreground">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className={`flex items-center gap-1.5 text-xs font-medium ${SECONDARY}`}>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-status-waiting" />
          Needs you
        </p>
        {entry.kind === 'approval' && <h3 className="text-[13px] leading-[18px] font-semibold break-words">{botTitle ?? entry.profile} needs your approval</h3>}
      </div>
    </div>
  )
}

/**
 * Keeps keyboard focus on the card when the control that held it unmounts (the request changed under the
 * user), so focus is not dropped to the top of the page. Focus the user moved elsewhere is left alone.
 */
function useFocusPark() {
  const card = useRef<HTMLDivElement>(null)
  const held = useRef<Element | null>(null)
  useLayoutEffect(() => {
    const control = held.current
    if (control === null || control.isConnected) return
    held.current = null
    const active = document.activeElement
    if (active === null || active === document.body) card.current?.focus()
  })
  return {
    ref: card,
    onFocus: (event: FocusEvent<HTMLDivElement>) => {
      held.current = event.target === card.current ? null : event.target
    },
    // A removed control fires no blur while connected, so this only clears focus that really moved away.
    onBlur: (event: FocusEvent<HTMLDivElement>) => {
      if (event.target.isConnected) held.current = null
    }
  }
}

/** One request waiting for the user: approval, question, or secret/sudo prompt. Shows only what Hermes sent. */
export function RequestCard({ entry, onAnswer, botTitle, header }: RequestCardProps) {
  const [sending, setSending] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const park = useFocusPark()
  const disabled = sending || entry.state === 'answering'
  const retry = entry.state === 'failed'
  const secret = entry.kind === 'secret' || entry.kind === 'sudo'
  const bare = header !== undefined

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
    <div
      {...park}
      data-testid="request-card"
      tabIndex={-1}
      className="rounded-2xl border border-border bg-raised p-3 text-sm text-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring"
    >
      {header ?? <CardHeading entry={entry} botTitle={botTitle} />}
      {entry.kind === 'approval' && <ApprovalDetail entry={entry} bare={bare} />}
      {!bare && (entry.kind === 'clarify' || (secret && !entry.answerable)) && <p className={SUMMARY}>{entry.summary}</p>}
      {!entry.answerable ? (
        <p className={`text-xs ${SECONDARY}`}>Answer this in the app that asked</p>
      ) : (
        <>
          {entry.kind === 'approval' && <ApprovalControls entry={entry} disabled={disabled} send={send} />}
          {entry.kind === 'clarify' && <ClarifyControls entry={entry} disabled={disabled} retry={retry} send={send} />}
          {secret && <SecretControls entry={entry} disabled={disabled} retry={retry} send={send} />}
        </>
      )}
      {disabled && (
        <p role="status" className={`mt-2 flex items-center gap-2 text-xs ${SECONDARY}`}>
          <IndeterminateBar label="Sending" className="w-10" />
          Sending…
        </p>
      )}
      {retry && entry.answerable && <p className={`mt-2 ${WARNING}`}>Couldn’t send: {FAILURES[entry.error ?? ''] ?? entry.error ?? 'unknown error'}. Try again.</p>}
      {message && <p className={`mt-2 text-xs ${SECONDARY}`}>{message}</p>}
    </div>
  )
}
