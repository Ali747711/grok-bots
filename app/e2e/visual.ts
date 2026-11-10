import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Page, expect } from '@playwright/test'

// The UI 2 visual check (spec §10): every screen in both themes, with no console error and no CSP violation.

export type Theme = 'dark' | 'light'

export interface Size {
  width: number
  height: number
}

/** What a screen's hooks get: the page and the theme and size this run shoots. */
export interface Ctx {
  page: Page
  theme: Theme
  size: Size
}

export interface Watcher {
  /** Console errors and uncaught page errors so far. */
  errors(): string[]
  /** CSP violations so far: console reports plus `securitypolicyviolation` events. */
  csp(): Promise<string[]>
}

export const THEMES: readonly Theme[] = ['dark', 'light']
const THEME_KEY = 'crew-theme'
const SHOTS = fileURLToPath(new URL('../../docs/ui2/screenshots/', import.meta.url))
const DEFAULT_SIZES = '1440x900'

declare global {
  interface Window {
    __csp?: string[]
  }
}

/** The sizes to shoot, from `UI2_SIZES` ("1440x900,1100x800"); 1440x900 by default. */
export function sizes(env: string | undefined = process.env.UI2_SIZES): Size[] {
  return (env || DEFAULT_SIZES).split(',').map(part => {
    const match = /^\s*(\d+)x(\d+)\s*$/.exec(part)
    if (!match) throw new Error(`UI2_SIZES: "${part}" is not <width>x<height>`)
    return { width: Number(match[1]), height: Number(match[2]) }
  })
}

export const sizeLabel = (size: Size): string => `${size.width}x${size.height}`

/** `task-<N>-<screen>` while a task builds it; `<screen>` alone for the final set (`UI2_FINAL=1`, Task 18). */
export const shotName = (task: number, screen: string): string => (process.env.UI2_FINAL === '1' ? screen : `task-${task}-${screen}`)

/** Start collecting errors and CSP violations. Call it before the first navigation. */
export async function watch(page: Page): Promise<Watcher> {
  const errors: string[] = []
  const cspReports: string[] = []
  page.on('console', message => {
    const text = message.text()
    if (/Content Security Policy/i.test(text)) cspReports.push(text)
    else if (message.type() === 'error') errors.push(text)
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const seen: string[] = []
    window.__csp = seen
    document.addEventListener('securitypolicyviolation', event => {
      seen.push(`${event.violatedDirective} ${event.blockedURI}`)
    })
  })
  return {
    errors: () => [...errors],
    csp: async () => [...cspReports, ...(await page.evaluate(() => window.__csp ?? []))]
  }
}

/**
 * Set the viewport and the theme before the screen opens. The theme goes in both ways the app reads it:
 * `prefers-color-scheme` (the server-rendered login page, and 'system') and the stored `crew-theme` choice.
 */
export async function prepare({ page, theme, size }: Ctx): Promise<void> {
  await page.setViewportSize(size)
  await page.emulateMedia({ colorScheme: theme })
  await page.addInitScript(([key, value]) => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // about:blank and other opaque origins have no storage; the next navigation sets it.
    }
  }, [THEME_KEY, theme] as const)
}

/** Save `docs/ui2/screenshots/<name>-<theme>-<w>x<h>.png` once the page shows the expected theme. Returns the path. */
export async function shoot({ page, theme, size }: Ctx, name: string): Promise<string> {
  await page.setViewportSize(size)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  mkdirSync(SHOTS, { recursive: true })
  const path = join(SHOTS, `${name}-${theme}-${sizeLabel(size)}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  return path
}
