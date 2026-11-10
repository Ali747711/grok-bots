import { toast } from 'sonner'

import { CrewApiError, crewJson } from '@/lib/crew-json'

import type { CreatedTrigger, NewTrigger, TestEventResult, TriggerEvent, TriggerPatch, TriggerView, Unsaved } from './types'

const botPath = (bot: string) => `/crew/bots/${encodeURIComponent(bot)}/triggers`
const idPath = (id: string, action?: string) => `/crew/triggers/${encodeURIComponent(id)}${action ? `/${action}` : ''}`

export async function listTriggers(bot: string): Promise<TriggerView[]> {
  const out = await crewJson<{ triggers?: TriggerView[] }>(botPath(bot), 'GET')
  return out.triggers ?? []
}
export const createTrigger = (bot: string, body: NewTrigger) => crewJson<CreatedTrigger>(botPath(bot), 'POST', body)
export const updateTrigger = (id: string, patch: TriggerPatch) => crewJson<TriggerView & Unsaved>(idPath(id), 'PATCH', patch)
export const newSecret = (id: string) => crewJson<{ secret: string } & Unsaved>(idPath(id, 'secret'), 'POST')

/** 204 normally, 200 `{saved:false}` when the file write failed: both mean the trigger is gone. */
export async function deleteTrigger(id: string): Promise<Unsaved> {
  const out = await crewJson<Unsaved | undefined>(idPath(id), 'DELETE')
  return out?.saved === false ? { saved: false } : {}
}

export async function listTriggerEvents(id: string): Promise<TriggerEvent[]> {
  const out = await crewJson<{ events?: TriggerEvent[] }>(idPath(id, 'events'), 'GET')
  return out.events ?? []
}
export const sendTestEvent = (id: string) => crewJson<TestEventResult>(idPath(id, 'test'), 'POST')

/** The change is live but not on disk yet: say so, once. */
export function warnUnsaved(result: Unsaved | undefined): void {
  if (result?.saved === false) toast.warning("Saved for now, but Crew couldn't write it to disk yet.")
}

const ERRORS: Record<string, string> = {
  bad_body: "Some fields aren't filled in correctly.",
  routine_not_found: 'That routine no longer exists.',
  not_found: 'That trigger no longer exists.',
  hermes_offline: 'Hermes is offline',
  triggers_unavailable: "Triggers are off: Crew couldn't read its triggers file."
}

export function triggerErrorText(e: unknown): string {
  const code = e instanceof CrewApiError ? e.body?.error : undefined
  return (typeof code === 'string' ? ERRORS[code] : undefined) ?? 'Something went wrong. Try again.'
}
