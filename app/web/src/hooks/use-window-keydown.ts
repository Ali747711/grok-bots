import { useEffect, useEffectEvent } from 'react'

import { liveControlHeld } from '@/lib/live-control'

const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const LIVE_VIEW = '[data-testid="live-view"]'
const ESC_SCOPES = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

function elementOf(node: EventTarget | Element | null): Element | null {
  return node instanceof Element ? node : null
}

/** True when the event started in a field the user is typing into. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  // isContentEditable is missing in jsdom, so the attribute is checked as well.
  if (target.isContentEditable || target.closest('[contenteditable]:not([contenteditable="false"])') !== null) return true
  return target.closest('input, textarea, select') !== null
}

/** True for the bot's screen and anything inside it: those keys belong to the remote desktop. */
export function isInsideLiveView(node: EventTarget | Element | null): boolean {
  return elementOf(node)?.closest(LIVE_VIEW) != null
}

/**
 * Whether a window shortcut must stand down: the user is typing, is inside the bot's screen or holds
 * control of it, or something already handled the key. Esc also stands down inside open popups,
 * which close themselves.
 */
export function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  if (event.defaultPrevented) return true
  if (isEditableTarget(event.target)) return true
  const active = typeof document === 'undefined' ? null : document.activeElement
  if (isInsideLiveView(event.target) || isInsideLiveView(active)) return true
  if (liveControlHeld()) return true
  if (event.key === 'Escape') {
    return elementOf(event.target)?.closest(ESC_SCOPES) != null || active?.closest(ESC_SCOPES) != null
  }
  return false
}

/** The platform's command modifier: ⌘ on Apple devices, Ctrl elsewhere (Ctrl edits text on macOS). */
export function isModKey(event: KeyboardEvent): boolean {
  return IS_APPLE ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

/** Display label for a command shortcut, e.g. "⌘K" or "Ctrl K". */
export function modShortcut(key: string): string {
  return IS_APPLE ? `⌘${key}` : `Ctrl ${key}`
}

/** Subscribes to window keydown for app-level shortcuts. Callers check `shouldIgnoreShortcut`. */
export function useWindowKeydown(handler: (event: KeyboardEvent) => void): void {
  const onKeydown = useEffectEvent(handler)

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeydown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}
