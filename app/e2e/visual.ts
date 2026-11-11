import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type Locator, type Page, expect } from '@playwright/test'

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
const SHOT_TIMEZONE = 'UTC'

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
  // The shots are committed: a fixed zone keeps the machine's own out of every time and timezone field.
  await (await page.context().newCDPSession(page)).send('Emulation.setTimezoneOverride', { timezoneId: SHOT_TIMEZONE })
  await page.addInitScript(([key, value]) => {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // about:blank and other opaque origins have no storage; the next navigation sets it.
    }
  }, [THEME_KEY, theme] as const)
}

const E2E_HANDLE = /^e2e\d+$/
/** XPath 1.0 has no regex: a handle is `e2e<digits>` when what follows "e2e" is non-empty and all digits. */
const IS_E2E_HANDLE = "starts-with(@data-bot,'e2e') and string-length(@data-bot)>3 and translate(substring(@data-bot,4),'0123456789','')=''"
const MASK_COLOR = '#808080'

/**
 * What every shot covers, because the screenshots are committed: anything named after a bot that is not a
 * test bot (rail rows and their previews), every group row, the rail header's bot count line, the credit
 * balance, every connected-app row (the Apps dialog lists the user's own apps), the app names on a profile's
 * Apps tab and anything marked `data-private` (the Composio key row and the credit line in Settings).
 */
export function privateParts(page: Page): Locator[] {
  return [
    page.locator(`xpath=//*[@data-bot and not(${IS_E2E_HANDLE})]`),
    page.locator('[data-group]'),
    // By tag, not by role: an open dialog hides the rail from the accessibility tree, and the line is still in the shot.
    page.locator('aside[aria-label="Sidebar"] header h1 + p'),
    page.getByTestId('credit-pill'),
    page.locator('[data-app]'),
    // The profile's Apps tab: each connected app's tile and name (the switch and the level chips stay visible).
    page.getByRole('main').locator('li[data-bot] > div:first-child > :not([role="switch"])'),
    page.locator('[data-private]')
  ]
}

/** Throws when the page is a bot's chat that is not a test bot's: its transcript would be in the shot. */
export function assertTestBotPage(url: string): void {
  const name = /^\/bots\/([^/]+)/.exec(new URL(url).pathname)?.[1]
  if (name !== undefined && !E2E_HANDLE.test(decodeURIComponent(name))) {
    throw new Error(`refusing to shoot /bots/${name}: only e2e<digits> bot pages are shot`)
  }
}

/**
 * Save `docs/ui2/screenshots/<name>-<theme>-<w>x<h>.png` once the page shows the expected theme. Returns the path.
 * Always masks `privateParts` and refuses a bot page that is not a test bot's.
 */
export async function shoot({ page, theme, size }: Ctx, name: string): Promise<string> {
  assertTestBotPage(page.url())
  await page.setViewportSize(size)
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
  await page.evaluate(async () => {
    await document.fonts.ready
  })
  return save({ page, theme, size }, name)
}

async function save({ page, theme, size }: Ctx, name: string): Promise<string> {
  mkdirSync(SHOTS, { recursive: true })
  const path = join(SHOTS, `${name}-${theme}-${sizeLabel(size)}.png`)
  await page.screenshot({ path, animations: 'disabled', mask: privateParts(page), maskColor: MASK_COLOR })
  return path
}

const LOGIN_PATH = '/login'

/**
 * The same shot for the server-rendered login page, which has no `data-theme`: it follows `prefers-color-scheme`
 * alone. Refuses any other page, a signed-in context and a link that carries a ticket.
 */
export async function shootLogin({ page, theme, size }: Ctx, name: string): Promise<string> {
  const url = new URL(page.url())
  if (url.pathname !== LOGIN_PATH || url.hash !== '' || url.search !== '') throw new Error(`refusing to shoot ${url.pathname}: only a bare ${LOGIN_PATH} is shot here`)
  if ((await page.context().cookies()).length > 0) throw new Error('refusing to shoot the login page from a context that holds cookies')
  await page.setViewportSize(size)
  expect(await page.evaluate(scheme => window.matchMedia(`(prefers-color-scheme: ${scheme})`).matches, theme), `prefers-color-scheme is ${theme}`).toBe(true)
  return save({ page, theme, size }, name)
}
