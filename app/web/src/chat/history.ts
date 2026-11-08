import type { ChatItem, WorkStep } from './types'

/**
 * A stored message row from `GET /api/sessions/:id/messages`. Only the fields Crew reads are typed;
 * `display_kind` marks scaffolding (`hidden` is dropped), relayed messages (`internal_notification`, shown as a notice) and `failed_turn`.
 */
export interface HistoryRow {
  id: number | string
  role: string
  content?: string | null
  display_content?: string | null
  display_kind?: string | null
  tool_call_id?: string | null
  tool_name?: string | null
  tool_calls?: readonly { id?: string; function?: { name?: string; arguments?: string } }[] | null
}

const HIDDEN_KINDS = new Set(['hidden'])
const NOTICE_MAX = 300
const RELAYED = /^Message from [^(]*\(@([^)\s]+)\):\s*/

/** One-line label for a tool call: its first string argument (the command, path, query…) or the tool name. */
export function summarizeArguments(name: string, raw: string | undefined): string {
  try {
    const args: unknown = JSON.parse(raw ?? '')
    if (args && typeof args === 'object') {
      const first = Object.values(args).find((v): v is string => typeof v === 'string' && v.length > 0)
      if (first) return first
    }
  } catch {
    // Unparseable arguments fall back to the tool name.
  }
  return name
}

/** Whether a tool result body reports a failure (non-zero exit code or a non-null error). */
function resultIsError(content: string): boolean {
  try {
    const body: unknown = JSON.parse(content)
    if (body && typeof body === 'object') {
      const { exit_code: code, error } = body as { exit_code?: unknown; error?: unknown }
      return (typeof code === 'number' && code !== 0) || (error !== null && error !== undefined && error !== '')
    }
  } catch {
    // Plain-text results are not errors.
  }
  return false
}

/** `From @handle: <first 300 chars>` for a relayed bot message, else the text cut to 300 chars. */
function relayedNotice(text: string): string {
  const match = RELAYED.exec(text)
  return match ? `From @${match[1]}: ${text.slice(match[0].length, match[0].length + NOTICE_MAX)}` : text.slice(0, NOTICE_MAX)
}

const textOf = (row: HistoryRow): string => (row.display_content ?? row.content ?? '').trim()

/** Stored rows → chat items: user/assistant text, consecutive tool rows as one work block, scaffolding dropped. */
export function historyToItems(rows: readonly HistoryRow[]): ChatItem[] {
  const items: ChatItem[] = []
  // Held in an object so closures and the loop see the same mutable slot.
  const open: { work: { id: string; steps: WorkStep[] } | null } = { work: null }

  const flush = () => {
    if (open.work) items.push({ kind: 'work', id: open.work.id, steps: open.work.steps })
    open.work = null
  }
  const openWork = (rowId: number | string) => (open.work ??= { id: `work-${rowId}`, steps: [] })

  for (const row of rows) {
    if (row.display_kind && HIDDEN_KINDS.has(row.display_kind)) continue
    const id = `row-${row.id}`
    const text = textOf(row)

    if (row.role === 'tool') {
      const w = openWork(row.id)
      const at = w.steps.findIndex(s => s.id === row.tool_call_id)
      const detail = row.content ?? undefined
      const isError = resultIsError(row.content ?? '')
      const existing = w.steps[at]
      if (existing) w.steps[at] = { ...existing, ...(detail ? { detail } : {}), isError, running: false }
      else w.steps.push({ id: row.tool_call_id ?? id, name: row.tool_name ?? 'tool', summary: row.tool_name ?? 'tool', ...(detail ? { detail } : {}), isError, running: false })
      continue
    }
    if (row.role === 'assistant' && row.tool_calls?.length) {
      if (text) {
        flush()
        items.push({ kind: 'assistant', id, text })
      }
      const w = openWork(row.id)
      for (const call of row.tool_calls) {
        const name = call.function?.name ?? 'tool'
        w.steps.push({ id: call.id ?? `${id}-${w.steps.length}`, name, summary: summarizeArguments(name, call.function?.arguments), running: false })
      }
      continue
    }
    if (!text) continue
    flush()
    if (row.display_kind === 'failed_turn') items.push({ kind: 'notice', id, text })
    else if (row.display_kind === 'internal_notification') items.push({ kind: 'notice', id, text: relayedNotice(text) })
    else if (row.role === 'user') items.push({ kind: 'user', id, text })
    else if (row.role === 'assistant') items.push({ kind: 'assistant', id, text })
  }
  flush()
  return items
}
