import { crewFetch } from '@/lib/crew-api'
import type { CrewSettings } from '@/state/types'

/** `PUT /crew/settings`; resolves with the saved settings and throws when the server refuses. */
export async function saveSettings(settings: CrewSettings): Promise<CrewSettings> {
  const res = await crewFetch('/crew/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
  if (!res.ok) throw new Error(`save failed (${res.status})`)
  return (await res.json()) as CrewSettings
}
