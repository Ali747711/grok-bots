import { useSyncExternalStore } from 'react'

import { type ThemeName, type ThemePreference, currentThemePreference, saveThemePreference, subscribeThemePreference } from './theme'

export type { ThemeName, ThemePreference } from './theme'

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

const read = (): ThemeName => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** The current `<html data-theme>`, live (set by `startTheme`). */
export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribe, read, () => 'light')
}

/** The user's preference and its setter (which saves and applies at once). */
export function useThemePreference(): readonly [ThemePreference, (preference: ThemePreference) => void] {
  const preference = useSyncExternalStore(subscribeThemePreference, currentThemePreference, () => 'system' as const)
  return [preference, saveThemePreference] as const
}

/** The `d` key: save the opposite of what is on screen now, so it always visibly flips. */
export function toggleTheme(): void {
  saveThemePreference(read() === 'dark' ? 'light' : 'dark')
}
