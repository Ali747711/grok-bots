import { crewFetch } from '@/lib/crew-api'
import type { BotView } from '@/state/types'

import { historyToItems, type HistoryRow } from './history'
import type { ChatItem } from './types'

/** The one method of the gateway client the chat layer needs for RPC (fakeable in tests). */
export interface RpcClient {
  request<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>
}

export interface OpenedChat {
  sessionId: string
  generation: number
  running: boolean
}

interface Snapshot {
  session_id: string
  execution_generation?: number | null
  running?: boolean | null
}

/**
 * Open a bot's canonical "Bot Chat" (a hidden session titled exactly that).
 * The roster has a chat → resume it (subscribes this connection). No chat yet → create it.
 * A failed resume throws: a lookup failure must never create a second chat.
 */
export async function openBotChat(client: RpcClient, bot: BotView): Promise<OpenedChat> {
  const snapshot = bot.sessionId
    ? await client.request<Snapshot>('session.resume', { profile: bot.name, session_id: bot.sessionId, omit_messages: true })
    : await client.request<Snapshot>('session.create', { profile: bot.name, title: 'Bot Chat', hidden: true, follow_profile_config: true })
  return {
    sessionId: snapshot.session_id,
    generation: typeof snapshot.execution_generation === 'number' ? snapshot.execution_generation : 0,
    running: snapshot.running === true
  }
}

/** Stored transcript of a session, via Crew's REST proxy. */
export async function fetchHistory(bot: string, sessionId: string): Promise<ChatItem[]> {
  const query = `profile=${encodeURIComponent(bot)}&limit=120&order=latest&include_compacted=true`
  const res = await crewFetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?${query}`)
  if (!res.ok) throw new Error(`history request failed (${res.status})`)
  const body: unknown = await res.json()
  const messages = (body as { messages?: unknown } | null)?.messages
  if (!Array.isArray(messages)) throw new Error('history response had no messages')
  return historyToItems(messages as HistoryRow[])
}
