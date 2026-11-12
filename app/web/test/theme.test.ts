import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { THEME_STORAGE_KEY, readThemePreference, saveThemePreference, startTheme, subscribeThemePreference } from '@/lib/theme'
import { toggleTheme, useTheme, useThemePreference } from '@/lib/use-theme'

type Listener = (e: { matches: boolean }) => void

/** The OS colour scheme, switchable from the test. */
function stubOs(dark: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches: dark,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l)
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mql))
  return {
    set: (next: boolean) => {
      mql.matches = next
      listeners.forEach(l => l({ matches: next }))
    },
    listeners
  }
}

/** Storage that throws on every access, like a private window or blocked site data. */
function blockStorage() {
  vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
    throw new DOMException('The operation is insecure.', 'SecurityError')
  })
}

const html = () => document.documentElement.dataset.theme
let stop: (() => void) | undefined

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  stop?.()
  stop = undefined
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete document.documentElement.dataset.theme
})

describe('theme preference', () => {
  it('defaults to system and follows the OS live', () => {
    const os = stubOs(false)
    stop = startTheme()
    expect(readThemePreference()).toBe('system')
    expect(html()).toBe('light')
    os.set(true)
    expect(html()).toBe('dark')
    os.set(false)
    expect(html()).toBe('light')
    stop()
    stop = undefined
    expect(os.listeners.size).toBe(0)
  })

  it('reads an invalid stored value as system', () => {
    stubOs(true)
    window.localStorage.setItem(THEME_STORAGE_KEY, 'sepia')
    stop = startTheme()
    expect(readThemePreference()).toBe('system')
    expect(html()).toBe('dark')
  })

  it('persists light and dark and applies them at once', () => {
    const os = stubOs(false)
    stop = startTheme()
    const onChange = vi.fn()
    const unsubscribe = subscribeThemePreference(onChange)

    saveThemePreference('dark')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(readThemePreference()).toBe('dark')
    expect(html()).toBe('dark')
    expect(onChange).toHaveBeenCalledTimes(1)
    os.set(false)
    expect(html()).toBe('dark')

    saveThemePreference('light')
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(html()).toBe('light')
    unsubscribe()
    saveThemePreference('system')
    expect(onChange).toHaveBeenCalledTimes(2)

    // A fresh start (a reload) reads the stored choice before the first render.
    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    stop()
    stop = startTheme()
    expect(html()).toBe('dark')
  })

  it('falls back to system when localStorage throws on read and write', () => {
    const os = stubOs(true)
    blockStorage()
    expect(() => window.localStorage).toThrow('insecure')
    expect(() => { stop = startTheme() }).not.toThrow()
    expect(readThemePreference()).toBe('system')
    expect(html()).toBe('dark')
    os.set(false)
    expect(html()).toBe('light')
    // The choice still applies to this tab; it just cannot be kept.
    expect(() => saveThemePreference('dark')).not.toThrow()
    expect(html()).toBe('dark')
    expect(() => window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY }))).not.toThrow()
  })

  it('syncs a change made in another tab', () => {
    stubOs(false)
    stop = startTheme()
    const onChange = vi.fn()
    const unsubscribe = subscribeThemePreference(onChange)

    window.localStorage.setItem(THEME_STORAGE_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: THEME_STORAGE_KEY, newValue: 'dark' }))
    expect(html()).toBe('dark')
    expect(onChange).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new StorageEvent('storage', { key: 'crew-side-panel', newValue: 'computer' }))
    expect(onChange).toHaveBeenCalledTimes(1)

    // Another tab clearing the site's storage means "system" again.
    window.localStorage.clear()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(html()).toBe('light')
    expect(onChange).toHaveBeenCalledTimes(2)
    unsubscribe()
  })

  it('toggleTheme saves the opposite of the resolved theme', () => {
    stubOs(true)
    stop = startTheme()
    toggleTheme()
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('light')
    expect(html()).toBe('light')
    toggleTheme()
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark')
    expect(html()).toBe('dark')
  })

  it('gives components the live preference and the resolved theme', async () => {
    stubOs(false)
    stop = startTheme()
    const { result } = renderHook(() => ({ preference: useThemePreference(), theme: useTheme() }))
    expect(result.current.preference[0]).toBe('system')
    expect(result.current.theme).toBe('light')
    await act(async () => { result.current.preference[1]('dark') })
    expect(result.current.preference[0]).toBe('dark')
    expect(result.current.theme).toBe('dark')
  })
})
