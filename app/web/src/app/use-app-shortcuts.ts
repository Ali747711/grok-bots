import { isModKey, shouldIgnoreShortcut, useWindowKeydown } from '@/hooks/use-window-keydown'
import { toggleTheme } from '@/lib/use-theme'

interface AppShortcutActions {
  /** ⌘\ (Ctrl \): show or hide the side panel. Left out where there is no side panel to toggle. */
  toggleSide?: () => void
  /** Esc: leave the profile or the Needs-you page. Left out on pages Esc does not leave. */
  leave?: () => void
}

/**
 * The app's window shortcuts: ⌘\, Esc and `d` (light / dark). Every one stands down while the user types
 * in a field, is inside the bot's screen or holds control of it (R7).
 */
export function useAppShortcuts({ toggleSide, leave }: AppShortcutActions): void {
  useWindowKeydown(event => {
    if (event.repeat || shouldIgnoreShortcut(event)) return
    if (isModKey(event) && !event.altKey && event.key === '\\') {
      if (!toggleSide) return
      event.preventDefault()
      toggleSide()
      return
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === 'Escape') {
      if (!leave) return
      event.preventDefault()
      leave()
      return
    }
    if (event.key.toLowerCase() === 'd') toggleTheme()
  })
}
