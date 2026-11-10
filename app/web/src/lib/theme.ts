export type ThemePreference = 'system' | 'light' | 'dark'
export type ThemeName = 'light' | 'dark'

export const THEME_STORAGE_KEY = 'crew-theme'

const QUERY = '(prefers-color-scheme: dark)'
const PREFERENCES: readonly string[] = ['system', 'light', 'dark']

const isPreference = (value: unknown): value is ThemePreference => typeof value === 'string' && PREFERENCES.includes(value)

// This tab's preference. It is the source of truth while the tab is open, so a choice still applies
// when storage refuses the write (private windows, blocked site data).
let current: ThemePreference = 'system'
const listeners = new Set<() => void>()

/** The stored preference; anything invalid, missing or unreadable means 'system'. */
export function readThemePreference(): ThemePreference {
  try {
    const value = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isPreference(value) ? value : 'system'
  } catch {
    // Storage can throw on access (blocked site data); the spec's default applies.
    return 'system'
  }
}

/** This tab's live preference (what the app shows, even when storage is unavailable). */
export function currentThemePreference(): ThemePreference {
  return current
}

const osIsDark = (): boolean => window.matchMedia?.(QUERY).matches ?? false

function resolve(preference: ThemePreference): ThemeName {
  if (preference === 'system') return osIsDark() ? 'dark' : 'light'
  return preference
}

/** `<html data-theme>` is the single trigger for both the CSS tokens and Tailwind's `dark:` variant. */
function apply(): void {
  document.documentElement.dataset.theme = resolve(current)
}

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/** Save and apply a preference at once, and tell subscribers. */
export function saveThemePreference(preference: ThemePreference): void {
  current = preference
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    // Storage refused the write: the choice still applies to this tab, it just is not kept.
  }
  apply()
  notify()
}

export function subscribeThemePreference(onChange: () => void): () => void {
  listeners.add(onChange)
  return () => {
    listeners.delete(onChange)
  }
}

/**
 * Applies the stored preference to `<html data-theme>` before the first render, follows the OS while it is
 * 'system', and picks up changes made in other tabs. Returns a cleanup.
 * Done in JS because the CSP forbids an inline script in index.html.
 */
export function startTheme(): () => void {
  current = readThemePreference()
  apply()
  const media = window.matchMedia?.(QUERY)
  const onOsChange = () => {
    if (current === 'system') apply()
  }
  // A null key means another tab cleared the site's storage.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return
    current = readThemePreference()
    apply()
    notify()
  }
  media?.addEventListener('change', onOsChange)
  window.addEventListener('storage', onStorage)
  return () => {
    media?.removeEventListener('change', onOsChange)
    window.removeEventListener('storage', onStorage)
  }
}
