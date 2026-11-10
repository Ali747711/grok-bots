import { ROLE_LABELS } from '@/features/bots/roles'
import type { BotView, HermesConnection } from '@/state/types'

export interface RailSections {
  readonly needsYou: readonly BotView[]
  readonly pinned: readonly BotView[]
  readonly crew: readonly BotView[]
  readonly hidden: readonly BotView[]
}

type SectionId = keyof RailSections

/** R5, in order of precedence: primary, needs you (only while statuses show), hidden, pinned, the rest. */
function sectionOf(bot: BotView, showStatus: boolean): SectionId {
  if (bot.isPrimary) return 'pinned'
  if (showStatus && bot.status === 'needs_you') return 'needsYou'
  if (bot.hidden) return 'hidden'
  return bot.pinned ? 'pinned' : 'crew'
}

/** Sorts the bots into the rail's sections, each bot in exactly one. Pinned has the primary first. */
export function railSections(bots: readonly BotView[], showStatus: boolean): RailSections {
  const of = (id: SectionId) => bots.filter(bot => sectionOf(bot, showStatus) === id)
  const pinned = of('pinned')
  return {
    needsYou: of('needsYou'),
    pinned: [...pinned.filter(bot => bot.isPrimary), ...pinned.filter(bot => !bot.isPrimary)],
    crew: of('crew'),
    hidden: of('hidden')
  }
}

/** Whether Find keeps this bot: the query is in its title, handle, job or role label. A blank query keeps every bot. */
export function matchesFind(bot: BotView, query: string): boolean {
  const term = query.trim().toLowerCase()
  if (term === '') return true
  const fields = [bot.title, bot.name, bot.job, bot.role ? ROLE_LABELS[bot.role] : '']
  return fields.some(field => field.toLowerCase().includes(term))
}

/** The header line: "6 bots · 2 working". Hidden bots are not counted; "working" shows only while statuses do. */
export function railSummary(bots: readonly BotView[], showStatus: boolean): string {
  const shown = bots.filter(bot => !bot.hidden)
  const working = showStatus ? shown.filter(bot => bot.status === 'working').length : 0
  const total = `${shown.length} ${shown.length === 1 ? 'bot' : 'bots'}`
  return working > 0 ? `${total} · ${working} working` : total
}

const HERMES_TEXT: Record<Exclude<HermesConnection, 'connected'>, string> = {
  connecting: 'Connecting…',
  offline: 'Hermes offline',
  signed_out: 'Signed out of Hermes'
}

/** The connection chip's text; null when everything is connected. A lost Crew stream comes first: nothing else is known then. */
export function connectionText(hermes: HermesConnection, crewConnected: boolean): string | null {
  if (!crewConnected) return 'Reconnecting…'
  return hermes === 'connected' ? null : HERMES_TEXT[hermes]
}
