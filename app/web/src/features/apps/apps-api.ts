import { CrewApiError, crewJson } from '@/lib/crew-json'

import type { AppLevel, AppsList, BotAppsView, Toolkit } from './apps-types'

const botPath = (bot: string) => `/crew/bots/${encodeURIComponent(bot)}/apps`

export const getKey = () => crewJson<{ configured: boolean }>('/crew/connectors/key', 'GET')
export const saveKey = (key: string) => crewJson<{ configured: boolean }>('/crew/connectors/key', 'PUT', { key })
export const removeKey = () => crewJson<void>('/crew/connectors/key', 'DELETE')
export const listApps = () => crewJson<AppsList>('/crew/connectors/apps', 'GET')
export const searchToolkits = (q: string) =>
  crewJson<{ toolkits: readonly Toolkit[] }>(`/crew/connectors/toolkits?search=${encodeURIComponent(q)}`, 'GET')
export const connect = (toolkit: string) =>
  crewJson<{ redirectUrl: string; connectionId: string }>('/crew/connectors/connect', 'POST', { toolkit })
export const pollConnect = (id: string) =>
  crewJson<{ state: 'pending' | 'connected' | 'failed' | 'expired' }>(`/crew/connectors/connect/${encodeURIComponent(id)}`, 'GET')
export const disconnect = (id: string) => crewJson<void>(`/crew/connectors/apps/${encodeURIComponent(id)}`, 'DELETE')
export const getBotApps = (bot: string) => crewJson<BotAppsView>(botPath(bot), 'GET')
export const setBotApps = (bot: string, apps: Readonly<Record<string, AppLevel>>) =>
  crewJson<BotAppsView>(botPath(bot), 'PUT', apps)

export const codeOf = (e: unknown): string | undefined => {
  const code = e instanceof CrewApiError ? e.body?.error : undefined
  return typeof code === 'string' ? code : undefined
}

/** The refusals of the apps routes that need no app name, in plain words. */
const APPS_REASONS: Readonly<Record<string, string>> = {
  no_key: 'Set the key in Settings',
  key_rejected: 'Key not accepted',
  composio_unavailable: "Couldn't reach Composio",
  level_unavailable: "This bot doesn't ask before actions, so it can only read in apps."
}

/** The sentence for an apps refusal code, or undefined for a code that is not one. */
export const appsReason = (code: string | null | undefined): string | undefined => (code ? APPS_REASONS[code] : undefined)

/** Why an apps call failed. */
export function appsErrorText(e: unknown, appName = 'this app'): string {
  const code = codeOf(e)
  if (code === 'app_unsupported') return `Crew can't connect ${appName} yet.`
  const reason = appsReason(code)
  if (reason) return reason
  if (e instanceof CrewApiError && e.status === 503) return 'Hermes is offline'
  return "Couldn't change the apps. Try again."
}
