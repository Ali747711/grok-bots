import { afterEach, describe, expect, it, vi } from 'vitest'

import { isEditableTarget, isInsideLiveView, shouldIgnoreShortcut } from '@/hooks/use-window-keydown'
import { setLiveControlHeld } from '@/lib/live-control'

function keydownOn(target: Element, init: KeyboardEventInit = {}): KeyboardEvent {
  const seen: KeyboardEvent[] = []
  const listener = (e: Event) => seen.push(e as KeyboardEvent)
  document.addEventListener('keydown', listener)
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true, ...init }))
  document.removeEventListener('keydown', listener)
  return seen[0]!
}

afterEach(() => {
  setLiveControlHeld(false)
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.resetModules()
})

describe('shortcut guard', () => {
  it('ignores shortcuts from inputs, textareas, selects and contentEditable', () => {
    document.body.innerHTML = '<input id="a"><textarea id="b"></textarea><select id="c"></select><div id="d" contenteditable="true"><span id="e"></span></div><button id="f"></button>'
    for (const id of ['a', 'b', 'c', 'e']) {
      const el = document.getElementById(id)!
      expect(isEditableTarget(el), id).toBe(true)
      expect(shouldIgnoreShortcut(keydownOn(el)), id).toBe(true)
    }
    expect(shouldIgnoreShortcut(keydownOn(document.getElementById('f')!))).toBe(false)
  })

  it('ignores shortcuts from inside the live view and while control is held', () => {
    document.body.innerHTML = '<div data-testid="live-view"><canvas id="c" tabindex="0"></canvas></div><button id="b"></button>'
    const canvas = document.getElementById('c')!
    expect(isInsideLiveView(canvas)).toBe(true)
    expect(shouldIgnoreShortcut(keydownOn(canvas))).toBe(true)
    // Focus inside the screen but the event aimed at the body: the focused element still counts.
    canvas.focus()
    expect(shouldIgnoreShortcut(keydownOn(document.body))).toBe(true)
    canvas.blur()
    const outside = document.getElementById('b')!
    expect(shouldIgnoreShortcut(keydownOn(outside))).toBe(false)
    setLiveControlHeld(true)
    expect(shouldIgnoreShortcut(keydownOn(outside))).toBe(true)
  })

  it('ignores a prevented event and lets a plain body event through', () => {
    expect(shouldIgnoreShortcut(keydownOn(document.body))).toBe(false)
    const seen: KeyboardEvent[] = []
    const first = (e: Event) => e.preventDefault()
    const last = (e: Event) => seen.push(e as KeyboardEvent)
    document.addEventListener('keydown', first)
    document.addEventListener('keydown', last)
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', bubbles: true, cancelable: true }))
    document.removeEventListener('keydown', first)
    document.removeEventListener('keydown', last)
    expect(shouldIgnoreShortcut(seen[0]!)).toBe(true)
  })

  it('ignores Esc while focus is inside a dialog, menu or listbox', () => {
    document.body.innerHTML = '<div role="dialog"><button id="a"></button></div><div role="listbox"><button id="b"></button></div><button id="c"></button>'
    expect(shouldIgnoreShortcut(keydownOn(document.getElementById('a')!, { key: 'Escape' }))).toBe(true)
    expect(shouldIgnoreShortcut(keydownOn(document.getElementById('b')!, { key: 'Escape' }))).toBe(true)
    expect(shouldIgnoreShortcut(keydownOn(document.getElementById('a')!, { key: 'd' }))).toBe(false)
    expect(shouldIgnoreShortcut(keydownOn(document.getElementById('c')!, { key: 'Escape' }))).toBe(false)
  })

  it('uses ⌘ on Apple and Ctrl elsewhere', async () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' })
    vi.resetModules()
    const mac = await import('@/hooks/use-window-keydown')
    expect(mac.modShortcut('K')).toBe('⌘K')
    expect(mac.isModKey(new KeyboardEvent('keydown', { metaKey: true }))).toBe(true)
    expect(mac.isModKey(new KeyboardEvent('keydown', { ctrlKey: true }))).toBe(false)
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' })
    vi.resetModules()
    const other = await import('@/hooks/use-window-keydown')
    expect(other.modShortcut('K')).toBe('Ctrl K')
    expect(other.isModKey(new KeyboardEvent('keydown', { ctrlKey: true }))).toBe(true)
    expect(other.isModKey(new KeyboardEvent('keydown', { metaKey: true }))).toBe(false)
  })
})
