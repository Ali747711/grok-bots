import type { HermesConnection } from '@/state/types'

import { connectionText } from './rail-sections'

interface ConnectionChipProps {
  hermes: HermesConnection
  crewConnected: boolean
}

/** Says why the rail is stale ("Reconnecting…", "Hermes offline"). Nothing while everything is connected. */
export function ConnectionChip({ hermes, crewConnected }: ConnectionChipProps) {
  const text = connectionText(hermes, crewConnected)
  if (text === null) return null
  return (
    <span role="status" className="inline-flex h-6 min-w-0 items-center gap-1.5 rounded-full bg-raised px-2.5 text-xs font-medium text-muted-foreground">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-status-waiting" />
      <span className="truncate">{text}</span>
    </span>
  )
}
