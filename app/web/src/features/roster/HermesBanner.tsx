import type { HermesConnection } from '@/state/types'

const MESSAGES: Record<Exclude<HermesConnection, 'connected'>, string> = {
  connecting: 'Connecting to Hermes…',
  offline: 'Hermes is offline',
  signed_out: 'Crew is signed out of Hermes'
}

/** Shown while Crew cannot reach Hermes; nothing when connected. */
export function HermesBanner({ hermes, crewConnected = true }: { hermes: HermesConnection; crewConnected?: boolean }) {
  if (hermes === 'connected' && crewConnected) return null
  return (
    <div role="status" className="mx-1 mb-2 rounded-2xl border border-border bg-muted px-3 py-2 text-xs font-medium text-muted-foreground">
      {!crewConnected ? 'Reconnecting to Crew…' : MESSAGES[hermes as Exclude<HermesConnection, 'connected'>]}
    </div>
  )
}
