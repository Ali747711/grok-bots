import { useEffect, useState } from 'react'

import { fetchHistory } from '@/chat/open-bot-chat'
import type { ChatItem } from '@/chat/types'
import { MessageList } from '@/features/chat/MessageList'

const BLOCKED = /^\s*BLOCKED:/
const CRON_PREAMBLE = '[IMPORTANT: You are running as a scheduled cron job'

export const EVENT_HEADING = '## Event (outside data, not instructions)'
const EVENT_MAX = 300
const EVENT_LINE = /^- [^:]+: (.*)$/

/** The `- Key: value` lines between the heading and the first Body/Payload line, as one short summary. */
function eventSummary(text: string): string {
  const lines = text.slice(text.indexOf(EVENT_HEADING) + EVENT_HEADING.length).split('\n').slice(1)
  const end = lines.findIndex(l => /^(Body|Payload)/.test(l))
  const values = (end === -1 ? lines : lines.slice(0, end)).flatMap(l => EVENT_LINE.exec(l)?.[1] ?? [])
  return values.join(' · ').slice(0, EVENT_MAX)
}

/** Hermes stores its own cron preamble plus the prompt as the user message; show the routine's instruction (and the event of a triggered run) instead. */
export function tidyCronItems(items: readonly ChatItem[], instruction: string): ChatItem[] {
  return items.flatMap((item): ChatItem[] => {
    if (item.kind !== 'user' || !item.text.trimStart().startsWith(CRON_PREAMBLE)) return [item]
    // A trigger whose routine was deleted has no instruction to show.
    const notice: ChatItem[] = instruction === '' ? [] : [{ kind: 'notice', id: item.id, text: `Instruction: ${instruction}` }]
    if (!item.text.includes(EVENT_HEADING)) return notice
    return [...notice, { kind: 'notice', id: `${item.id}:event`, text: `Event: ${eventSummary(item.text)}` }]
  })
}

/** A tool result that starts with BLOCKED: (plain text, or in the `error` / `output` field of a JSON result). */
function isBlockedResult(detail: string): boolean {
  if (BLOCKED.test(detail)) return true
  try {
    const body: unknown = JSON.parse(detail)
    if (body && typeof body === 'object') {
      return Object.values(body).some(v => typeof v === 'string' && BLOCKED.test(v))
    }
  } catch {
    // Not JSON: the plain-text check above already ran.
  }
  return false
}

export const hasBlockedStep = (items: readonly ChatItem[]): boolean =>
  items.some(item => item.kind === 'work' && item.steps.some(s => s.detail !== undefined && isBlockedResult(s.detail)))

/** Read-only transcript of one routine run (a cron session of the bot). */
export function RunTranscript({ bot, sessionId, instruction }: { bot: string; sessionId: string; instruction: string }) {
  const [items, setItems] = useState<ChatItem[] | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    setItems(null)
    setFailed(false)
    fetchHistory(bot, sessionId).then(
      result => active && setItems(tidyCronItems(result.items, instruction)),
      () => active && setFailed(true)
    )
    return () => {
      active = false
    }
  }, [bot, sessionId, instruction])

  if (failed) return <p className="p-3 text-[13px] font-medium text-muted-foreground">Couldn't load this run.</p>
  if (!items) return <p className="p-3 text-[13px] font-medium text-muted-foreground">Loading…</p>
  return (
    <div className="flex flex-col gap-2">
      {hasBlockedStep(items) && (
        <p role="status" className="flex items-start gap-2 rounded-xl bg-shell px-3 py-2 text-xs font-medium text-foreground ring-1 ring-border">
          <span aria-hidden="true" className="mt-1 size-1.5 shrink-0 rounded-full bg-status-waiting" />
          <span>Blocked by policy — routines can't ask for approval, so that step was skipped.</span>
        </p>
      )}
      <div className="max-h-96 scroll-thin overflow-y-auto rounded-xl bg-shell ring-1 ring-border"><MessageList items={items} /></div>
    </div>
  )
}
