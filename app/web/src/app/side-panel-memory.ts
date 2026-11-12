import { type SidePanelTab, isSidePanelTab } from './panel-params'

export const SIDE_PANEL_KEY = 'crew-side-panel'

/**
 * The side panel the user last chose in this browser, or null for closed (R4). Nothing stored, an
 * unknown value and unreadable storage all mean closed, so a fresh browser starts with no panel.
 */
export function readSidePanel(): SidePanelTab | null {
  try {
    const value = window.localStorage.getItem(SIDE_PANEL_KEY)
    return isSidePanelTab(value) ? value : null
  } catch {
    // Storage can throw on access (private window, blocked site data): the default applies.
    return null
  }
}

/** Keep the user's choice. Called only from user actions (header buttons, side tabs, Close panel, ⌘\), never on a URL load. */
export function rememberSidePanel(tab: SidePanelTab | null): void {
  try {
    window.localStorage.setItem(SIDE_PANEL_KEY, tab ?? 'none')
  } catch {
    // Storage refused the write: the URL still holds the panel for this page, it just is not remembered.
  }
}
