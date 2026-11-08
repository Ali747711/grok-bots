import type { HermesConnection } from '@/state/types'

/** Used when the server sends no settings (older server). */
export const DEFAULT_MAX_WORKING_BOTS = 2

interface ReasonInput {
  hermes: HermesConnection
  crewConnected: boolean
  canSend: boolean
  /** Bots other than this one that are currently working. */
  othersWorking: number
  /** At most this many other bots may work before a new message is held back; null = no limit. */
  maxWorkingBots: number | null
}

/** Why the composer is disabled, in priority order, or null when sending is allowed. */
export function composerDisabledReason(i: ReasonInput): string | null {
  if (i.hermes !== 'connected') return 'Hermes is offline'
  if (!i.crewConnected) return 'Reconnecting to Crew…'
  if (!i.canSend) return 'Connecting to the chat…'
  if (i.maxWorkingBots !== null && i.othersWorking >= i.maxWorkingBots) {
    const n = i.maxWorkingBots
    return `${n} ${n === 1 ? 'bot is' : 'bots are'} working — wait, stop one, or raise the limit in Settings`
  }
  return null
}
