/** The side panel's tabs (`?panel=computer|routines`). */
export type SidePanelTab = 'computer' | 'routines'
/** Everything `?panel=` can open on a bot page; the profile replaces the conversation instead of sitting beside it. */
export type BotPanel = SidePanelTab | 'profile'
export type ProfileTab = 'identity' | 'avatar' | 'soul' | 'skills' | 'apps' | 'advanced'

const BOT_PANELS: readonly string[] = ['computer', 'routines', 'profile']
const PROFILE_TABS: readonly string[] = ['identity', 'avatar', 'soul', 'skills', 'apps', 'advanced']

export const isSidePanelTab = (value: unknown): value is SidePanelTab => value === 'computer' || value === 'routines'

/** The `?panel=` value on a bot page; anything unknown means no panel. */
export function parseBotPanel(value: string | null): BotPanel | null {
  return value !== null && BOT_PANELS.includes(value) ? (value as BotPanel) : null
}

/** The `?tab=` value on the profile; identity is the default and stands in for anything unknown (R6). */
export function parseProfileTab(value: string | null): ProfileTab {
  return value !== null && PROFILE_TABS.includes(value) ? (value as ProfileTab) : 'identity'
}

/** A bot page's URL. The tab is written only for the profile, and only when it is not the default. */
export function botUrl(name: string, panel: BotPanel | null, tab?: ProfileTab): string {
  const path = `/bots/${encodeURIComponent(name)}`
  if (!panel) return path
  const withTab = panel === 'profile' && tab !== undefined && tab !== 'identity'
  return `${path}?panel=${panel}${withTab ? `&tab=${tab}` : ''}`
}

/**
 * Where a rail click on a bot goes (R4): from a bot page it keeps that page's panel (none, side panel or
 * profile); from anywhere else it opens the side panel the user last chose.
 */
export function railTarget(name: string, from: { onBotPage: boolean; panel: BotPanel | null }, remembered: SidePanelTab | null): string {
  return botUrl(name, from.onBotPage ? from.panel : remembered)
}
