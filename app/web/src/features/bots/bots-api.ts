import { CrewApiError, crewJson } from '@/lib/crew-json'

import type { BotDetail, BotDraft, BotPatch, CreateResult, FinishBody, UpdateOutcome } from './types'

export { CrewApiError }
const bot = (name: string) => `/crew/bots/${encodeURIComponent(name)}`
const send = crewJson

export const createBot = (draft: BotDraft) => send<CreateResult>('/crew/bots', 'POST', draft)
export const finishBot = (name: string, body: FinishBody) => send<CreateResult>(`${bot(name)}/finish`, 'POST', body)
export const getBot = (name: string) => send<BotDetail>(bot(name), 'GET')
/** 409 is a normal answer here (`conflict` / `confirm_required`), so it resolves instead of throwing. */
export const updateBot = (name: string, patch: BotPatch) => send<UpdateOutcome>(bot(name), 'PATCH', patch, [409])
export const setAvatar = (name: string, image: string) => send<BotDetail>(`${bot(name)}/avatar`, 'PUT', { image })
export const clearAvatar = (name: string) => send<BotDetail>(`${bot(name)}/avatar`, 'DELETE')
export const deleteBot = (name: string) => send<void>(bot(name), 'DELETE')
