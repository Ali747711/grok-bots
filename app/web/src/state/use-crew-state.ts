import { useEffect, useState } from 'react'

import { crewFetch } from '@/lib/crew-api'

import type { CrewState } from './types'

function parseState(raw: string): CrewState | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && 'hermes' in value && Array.isArray((value as CrewState).bots)) return value as CrewState
  } catch {
    // A malformed frame is dropped; the next full snapshot replaces it.
  }
  return null
}

/** Live Crew state over SSE. `connected` is the browser-to-Crew stream, not the Hermes link (see `state.hermes`). */
export function useCrewState(): { state: CrewState | null; connected: boolean } {
  const [state, setState] = useState<CrewState | null>(null)
  const [connected, setConnected] = useState(false)

  useEffect(() => {
    const source = new EventSource('/crew/events')
    source.onopen = () => setConnected(true)
    source.addEventListener('state', event => {
      const next = parseState((event as MessageEvent<string>).data)
      if (next) setState(next)
    })
    source.onerror = () => {
      // EventSource reconnects by itself. A dead session also looks like an error, so probe:
      // crewFetch sends the user to /login on a 401.
      setConnected(false)
      void crewFetch('/crew/state').catch(() => undefined)
    }
    return () => source.close()
  }, [])

  return { state, connected }
}
