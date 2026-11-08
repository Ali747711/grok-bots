const QUERY = '(prefers-color-scheme: dark)'

/**
 * Mirrors the OS colour scheme into `<html data-theme>` (the single trigger for
 * both the CSS variables and Tailwind's `dark:` variant). Returns a cleanup.
 * Done in JS because the CSP forbids an inline script in index.html.
 */
export function applySystemTheme(): () => void {
  const media = window.matchMedia(QUERY)
  const apply = (dark: boolean) => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }
  const onChange = (e: { matches: boolean }) => apply(e.matches)
  apply(media.matches)
  media.addEventListener('change', onChange)
  return () => media.removeEventListener('change', onChange)
}
