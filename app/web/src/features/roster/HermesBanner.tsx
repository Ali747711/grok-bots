import type { HermesConnection } from '@/state/types'

const MESSAGES: Record<Exclude<HermesConnection, 'connected'>, string> = {
  connecting: 'Connecting to Hermes…',
  offline: 'Hermes is offline',
  signed_out: 'Crew is signed out of Hermes'
}

/** Shown while Crew cannot reach Hermes; nothing when connected. */
export function HermesBanner({ hermes }: { hermes: HermesConnection }) {
  if (hermes === 'connected') return null
  return (
    <div role="status" className="mx-1 mb-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
      {MESSAGES[hermes]}
    </div>
  )
}
