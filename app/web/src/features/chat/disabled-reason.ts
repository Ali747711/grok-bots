import type { HermesConnection } from '@/state/types'

/** Budget rule: at most this many other bots may be working before a new message is held back. */
export const MAX_WORKING_BOTS = 2

interface ReasonInput {
  hermes: HermesConnection
  crewConnected: boolean
  canSend: boolean
  /** Bots other than this one that are currently working. */
  othersWorking: number
}

/** Why the composer is disabled, in priority order, or null when sending is allowed. */
export function composerDisabledReason(i: ReasonInput): string | null {
  if (i.hermes !== 'connected') return 'Hermes is offline'
  if (!i.crewConnected) return 'Reconnecting to Crew…'
  if (!i.canSend) return 'Connecting to the chat…'
  if (i.othersWorking >= MAX_WORKING_BOTS) return `${MAX_WORKING_BOTS} bots are working — wait or stop one`
  return null
}
