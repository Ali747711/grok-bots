import { z } from 'zod'

import type { BotDeps } from '../bots/create.js'
import { HermesRestError } from '../hermes/errors.js'
import { log } from '../log.js'

export const SERVER_NAME = 'crew_apps'
export const TOKEN_ENV = 'MCP_CREW_APPS_API_KEY'
/** Sent by Hermes on every relay request with the calling profile's own name; the relay requires it to match the path. */
export const IDENTITY_HEADER = 'X-Crew-Bot'
export type Hermes = Pick<BotDeps, 'rpc' | 'rest'>

const SERVER_PATH = `/api/mcp/servers/${SERVER_NAME}`
const listSchema = z.looseObject({ servers: z.array(z.looseObject({ name: z.string(), enabled: z.boolean().optional() })) })
const rosterSchema = z.looseObject({
  profiles: z.array(z.looseObject({
    name: z.string(),
    canonical_session: z.looseObject({ id: z.string().optional(), resolved_id: z.string().nullish() }).nullish()
  }))
})

/** The crew_apps server as Hermes lists it, or null when it is not configured. */
export async function appsServer(h: Hermes, bot: string): Promise<{ readonly enabled: boolean } | null> {
  const body = listSchema.parse(await h.rest.request<unknown>('GET', '/api/mcp/servers', { query: { profile: bot } }))
  const found = body.servers.find(s => s.name === SERVER_NAME)
  return found ? { enabled: found.enabled !== false } : null
}

/**
 * R7: the token goes only in `bearer_token`; Hermes writes it to the profile .env, never into `config`.
 * `identity_header` with `value_from: profile` is resolved by Hermes at connect time to the profile that
 * opens the connection, and is part of the digest that decides whether a profile may adopt another
 * profile's live connection. So a clone of this config neither shares this bot's connection nor passes
 * the relay's identity check. The header is not a secret: it stops config cloning, not a token holder.
 */
export async function addAppsServer(h: Hermes, bot: string, url: string, token: string, enabled = true): Promise<void> {
  const config = { url, trust: 'untrusted', enabled, identity_header: { name: IDENTITY_HEADER, value_from: 'profile' } }
  await h.rpc('mcp.servers.add', { profile: bot, name: SERVER_NAME, config, bearer_token: token })
}

export async function setAppsServerEnabled(h: Hermes, bot: string, enabled: boolean): Promise<void> {
  await h.rest.request('PUT', `${SERVER_PATH}/enabled`, { query: { profile: bot }, body: { enabled, profile: bot } })
}

async function ignoreMissing(call: () => Promise<unknown>): Promise<void> {
  try {
    await call()
  } catch (error) {
    if (!(error instanceof HermesRestError && error.status === 404)) throw error
  }
}

/** R8: the one removal path (turn-off and the create strip): the server entry, then its token env var. */
export async function removeAppsServer(h: Hermes, bot: string): Promise<void> {
  await ignoreMissing(() => h.rest.request('DELETE', SERVER_PATH, { query: { profile: bot } }))
  await ignoreMissing(() => h.rest.request('DELETE', '/api/env', { body: { key: TOKEN_ENV, profile: bot } }))
}

async function chatOf(h: Hermes, bot: string): Promise<string | undefined> {
  const roster = rosterSchema.parse(await h.rpc<unknown>('profiles.list', { include_sessions: true }))
  const chat = roster.profiles.find(p => p.name === bot)?.canonical_session
  return chat?.resolved_id ?? chat?.id
}

/** Applies the new tool list to idle chats. Best effort: it never rejects (a busy chat picks it up later). */
export async function reloadMcp(h: Hermes, bot: string, withChat: boolean): Promise<void> {
  try {
    const session = withChat ? await chatOf(h, bot) : undefined
    await h.rpc('reload.mcp', { profile: bot, confirm: true, ...(session ? { session_id: session } : {}) })
  } catch (error) {
    log.warn('reload.mcp failed', { bot, error: error instanceof Error ? error.name : 'unknown' })
  }
}
