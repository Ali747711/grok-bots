import { crewFetch } from '@/lib/crew-api'

import type { BotDetail, BotDraft, BotPatch, CreateResult, FinishBody, UpdateOutcome } from './types'

/** A non-2xx answer from Crew: the status and the parsed JSON body (or null). */
export class CrewApiError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown> | null
  ) {
    super(`Crew answered ${status}`)
    this.name = 'CrewApiError'
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }
const bot = (name: string) => `/crew/bots/${encodeURIComponent(name)}`

async function send<T>(path: string, method: string, body?: unknown, accept: readonly number[] = []): Promise<T> {
  const res = await crewFetch(path, {
    method,
    ...(body === undefined ? {} : { headers: JSON_HEADERS, body: JSON.stringify(body) })
  })
  if (!res.ok && !accept.includes(res.status)) {
    const parsed: unknown = await res.json().catch(() => null)
    throw new CrewApiError(res.status, parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

export const createBot = (draft: BotDraft) => send<CreateResult>('/crew/bots', 'POST', draft)
export const finishBot = (name: string, body: FinishBody) => send<CreateResult>(`${bot(name)}/finish`, 'POST', body)
export const getBot = (name: string) => send<BotDetail>(bot(name), 'GET')
/** 409 is a normal answer here (`conflict` / `confirm_required`), so it resolves instead of throwing. */
export const updateBot = (name: string, patch: BotPatch) => send<UpdateOutcome>(bot(name), 'PATCH', patch, [409])
export const setAvatar = (name: string, image: string) => send<BotDetail>(`${bot(name)}/avatar`, 'PUT', { image })
export const clearAvatar = (name: string) => send<BotDetail>(`${bot(name)}/avatar`, 'DELETE')
export const deleteBot = (name: string) => send<void>(bot(name), 'DELETE')
