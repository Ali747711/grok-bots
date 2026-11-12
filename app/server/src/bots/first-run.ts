import { randomUUID } from 'node:crypto'

import { FIRST_RUN_PROMPT } from '../voice/copy.js'
import type { BotDeps } from './create.js'

export const TEST_BOT_RE = /^e2e\d+$/

/** Test bots get no greeting unless the create asks for one: every greeting costs a model turn. */
export function wantsFirstRun(name: string, requested: boolean | undefined): boolean {
  return requested ?? !TEST_BOT_RE.test(name)
}

/**
 * The bot's one greeting, sent as a hidden turn into its new chat: the owner sees only the reply. A chat
 * that already has messages gets none. Not retried; the caller logs a failure.
 */
export async function sendFirstRun(deps: Pick<BotDeps, 'rpc' | 'rest'>, bot: string, sessionId: string): Promise<'sent' | 'skipped'> {
  const page = await deps.rest.request<{ messages?: readonly unknown[] }>('GET', `/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    query: { profile: bot, limit: '1', order: 'latest' }
  })
  if ((page.messages ?? []).length > 0) return 'skipped'
  const resumed = await deps.rpc<{ session_id: string }>('session.resume', { profile: bot, session_id: sessionId, omit_messages: true })
  await deps.rpc('prompt.submit', {
    profile: bot, session_id: resumed.session_id, text: FIRST_RUN_PROMPT, submission_id: randomUUID(), display_kind: 'hidden'
  })
  return 'sent'
}
