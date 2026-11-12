import { crewFetch } from '@/lib/crew-api'
import type { CrewSettings } from '@/state/types'

/** The browser's IANA zone, or null when it reports none. */
export function browserTimeZone(): string | null {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || null
}

/** `PUT /crew/settings` with only the given keys; resolves with the saved settings and throws when refused. */
export async function saveSettings(patch: Partial<CrewSettings>): Promise<CrewSettings> {
  const res = await crewFetch('/crew/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch)
  })
  if (!res.ok) throw new Error(`save failed (${res.status})`)
  return (await res.json()) as CrewSettings
}
