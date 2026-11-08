import { useEffect, useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { fetchHistory } from '@/chat/open-bot-chat'
import type { ChatItem } from '@/chat/types'
import { MessageList } from '@/features/chat/MessageList'

const BLOCKED = /^\s*BLOCKED:/
const CRON_PREAMBLE = '[IMPORTANT: You are running as a scheduled cron job'

/** Hermes stores its own cron preamble plus the prompt as the user message; show the routine's instruction instead. */
export function tidyCronItems(items: readonly ChatItem[], instruction: string): ChatItem[] {
  return items.map(item =>
    item.kind === 'user' && item.text.trimStart().startsWith(CRON_PREAMBLE)
      ? { kind: 'notice', id: item.id, text: `Instruction: ${instruction}` }
      : item
  )
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

  if (failed) return <p className="p-3 text-sm text-muted-foreground">Couldn't load this run.</p>
  if (!items) return <p className="p-3 text-sm text-muted-foreground">Loading…</p>
  return (
    <div className="flex flex-col gap-2">
      {hasBlockedStep(items) && (
        <Alert role="status">
          <AlertDescription>Blocked by policy — routines can't ask for approval, so that step was skipped.</AlertDescription>
        </Alert>
      )}
      <div className="max-h-96 overflow-y-auto rounded-xl border border-border bg-card"><MessageList items={items} /></div>
    </div>
  )
}
