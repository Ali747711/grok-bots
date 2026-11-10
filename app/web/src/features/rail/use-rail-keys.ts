import { type KeyboardEvent as ReactKeyboardEvent, type RefObject, useCallback, useEffect, useRef } from 'react'

import { isModKey, shouldIgnoreShortcut, useWindowKeydown } from '@/hooks/use-window-keydown'
import type { BotView } from '@/state/types'

/** Every focusable row of the rail (bots and groups) carries `data-rail-row`, for the arrow keys. */
const RAIL_ROW = '[data-rail-row]'

const POPUPS = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

/** 0-8 for ⌥1 … ⌥9, otherwise null. `code` is used because ⌥digit types a symbol on macOS. */
function digitIndex(event: KeyboardEvent): number | null {
  if (!event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return null
  const match = /^Digit([1-9])$/.exec(event.code)
  return match ? Number(match[1]) - 1 : null
}

/** A dialog or menu is open over the rail, so the rail's shortcuts must not act behind it. */
function popupHasFocus(event: KeyboardEvent): boolean {
  const target = event.target instanceof Element ? event.target : null
  return target?.closest(POPUPS) != null || document.activeElement?.closest(POPUPS) != null
}

interface RailKeys {
  findRef: RefObject<HTMLInputElement | null>
  /** Handles of the bot rows on screen, top to bottom. */
  visible: readonly string[]
  onSelect: (name: string) => void
}

/**
 * The rail's window shortcuts: ⌘K (Ctrl K) focuses Find and ⌥1-⌥9 opens the bot at that position.
 * Both stand down in fields, inside the bot's screen and while the user holds control of it (R7):
 * ⌥2 there would switch bots and hand control back mid-task.
 */
export function useRailKeys({ findRef, visible, onSelect }: RailKeys): void {
  useWindowKeydown(event => {
    if (event.repeat || shouldIgnoreShortcut(event) || popupHasFocus(event)) return
    if (isModKey(event) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault()
      findRef.current?.focus()
      findRef.current?.select()
      return
    }
    const index = digitIndex(event)
    const name = index === null ? undefined : visible[index]
    if (name === undefined) return
    event.preventDefault()
    onSelect(name)
  })
}

/** ↑ / ↓ on a row move focus to the next or previous row, wrapping at the ends. Put it on the list's `onKeyDown`. */
export function moveBetweenRows(event: ReactKeyboardEvent<HTMLElement>): void {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(RAIL_ROW))
  const current = rows.indexOf(document.activeElement as HTMLElement)
  if (current === -1) return
  event.preventDefault()
  const step = event.key === 'ArrowDown' ? 1 : -1
  rows[(current + step + rows.length) % rows.length]?.focus()
}

/**
 * A row that changes section (pin, unpin, show) is unmounted and drawn again, which drops keyboard focus
 * to the page. Call the returned function with a selector for the control in use; once the row is back
 * and focus was dropped, focus returns to it. Moving focus anywhere else, or passing null, cancels the request.
 */
export function useFocusAfterMove(bots: readonly BotView[] | undefined): (selector: string | null) => void {
  const wanted = useRef<string | null>(null)
  useEffect(() => {
    const selector = wanted.current
    if (selector === null) return
    const active = document.activeElement
    if (active !== null && active !== document.body) {
      if (!active.matches(selector)) wanted.current = null
      return
    }
    const control = document.querySelector<HTMLElement>(selector)
    if (!control) return
    control.focus()
    wanted.current = null
  }, [bots])
  return useCallback((selector: string | null) => {
    wanted.current = selector
  }, [])
}
