import { useSyncExternalStore } from 'react'

export type ThemeName = 'light' | 'dark'

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

const read = (): ThemeName => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')

/** The current `<html data-theme>`, live (set by `applySystemTheme`). */
export function useTheme(): ThemeName {
  return useSyncExternalStore(subscribe, read, () => 'light')
}
