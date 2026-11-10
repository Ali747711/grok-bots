import { type Page, expect, test } from '@playwright/test'

import { CREW, crewApi } from './helpers.js'
import { type Ctx, THEMES, prepare, shoot, shotName, sizeLabel, sizes, watch } from './visual.js'

// Run one task's screens with `npx playwright test visual.spec.ts --grep @task<N>` on the deployed service.
// The user's bots are only ever read; the one bot this spec makes and deletes is an `e2e<digits>` bot.
// The shots are committed, so every screen opens on that bot and `shoot` masks the other bots' rows (see visual.ts).

/** One screen of the visual check. `open` navigates and waits until the screen is ready to shoot. */
interface Screen {
  id: string
  task: number
  setup?(ctx: Ctx): Promise<void>
  open(page: Page, ctx: Ctx): Promise<void>
  teardown?(ctx: Ctx): Promise<void>
}

const E2E_BOT = /^e2e\d+$/
const RUN = String(Math.floor(100000 + Math.random() * 800000))
/** The test-owned bot every screen opens on, and the only one a screen may change. */
const BOT = `e2e${RUN}`
const BOT_TITLE = `E2E Visual ${RUN}`

async function openBot(page: Page, name: string): Promise<void> {
  await page.goto(`${CREW}/bots/${name}`)
  await expect(page.locator(`[data-bot="${name}"]`)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
}

/** The conversation with the side panel on Screen; a new test bot's screen is off, so the tab shows Start screen. */
async function openSide(page: Page, name: string): Promise<void> {
  await page.goto(`${CREW}/bots/${name}?panel=computer`)
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Screen' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Panel' }).getByRole('button', { name: 'Start screen', exact: true })).toBeVisible({ timeout: 30_000 })
}

/** The profile in the work area, in place of the conversation. */
async function openProfile(page: Page, name: string, title: string): Promise<void> {
  await page.goto(`${CREW}/bots/${name}?panel=profile`)
  await expect(page.getByRole('button', { name: 'Back to chat' })).toBeVisible()
  await expect(page.getByRole('main').getByLabel('Name', { exact: true })).toHaveValue(title)
  await expect(page.getByRole('region', { name: 'Panel' })).toHaveCount(0)
}

const railRow = (page: Page, name: string) => page.locator(`[data-bot="${name}"]`)
const rail = (page: Page) => page.getByRole('complementary')
const railGroup = (page: Page, name: string | RegExp) => rail(page).getByRole('group', { name })

/** Wait until the sliding active pill has come to rest on the open bot's row (a spring `shoot` cannot freeze). */
async function pillAtRest(page: Page, name: string): Promise<void> {
  await expect.poll(() => railRow(page, name).evaluate(row => {
    const pill = row.firstElementChild
    if (!pill || pill.tagName !== 'DIV') return 'no pill'
    const a = row.getBoundingClientRect()
    const b = pill.getBoundingClientRect()
    return Math.abs(a.top - b.top) < 0.5 && Math.abs(a.height - b.height) < 0.5 ? 'at rest' : 'moving'
  })).toBe('at rest')
}

/** Read the test bot's own row from Crew's state. */
async function botState(page: Page, name: string): Promise<{ pinned?: boolean; hidden?: boolean }> {
  const state = (await crewApi(page, 'GET', '/crew/state')).body as { bots: { name: string; pinned?: boolean; hidden?: boolean }[] }
  return state.bots.find(b => b.name === name) ?? {}
}

/** Put the test bot back as it was made: not pinned, not hidden. Only ever the `e2e<digits>` bot. */
async function resetRailBot(page: Page, name: string): Promise<void> {
  if (!E2E_BOT.test(name)) throw new Error(`refusing to change ${name}: not a test bot`)
  const done = await crewApi(page, 'PATCH', `/crew/bots/${name}`, { pinned: false, hidden: false })
  expect(done.status, JSON.stringify(done.body)).toBeLessThan(300)
}

/**
 * The rail with Find typed. From the Needs-you page: Ctrl K focuses Find, the run number leaves only the test
 * bot, and ⌥1 opens it. The primary bot's row is only read: it has a Primary tag and no pin or hide.
 */
async function openRailFind(page: Page, name: string): Promise<void> {
  await page.goto(`${CREW}/needs-you`)
  await expect(railRow(page, name)).toBeVisible()
  const primary = railRow(page, 'default')
  await expect(primary.getByText('Primary', { exact: true })).toBeVisible()
  await expect(primary.getByRole('button')).toHaveCount(1)
  const find = page.getByRole('searchbox', { name: 'Find a bot' })
  await page.keyboard.press('Control+k')
  await expect(find).toBeFocused()
  await find.fill(RUN)
  await expect(rail(page).locator('[data-bot]')).toHaveCount(1)
  await find.fill('no such bot anywhere')
  await expect(rail(page).getByText('No bot matches')).toBeVisible()
  await find.fill(RUN)
  await find.blur()
  await page.keyboard.press('Alt+Digit1')
  await expect(page).toHaveURL(new RegExp(`/bots/${name}$`))
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
  await expect(railRow(page, name).getByRole('button').first()).toHaveAttribute('aria-current', 'page')
}

/** Pin the test bot from its row, unpin it (Crew must store `pinned: false`), and pin it again for the shot. */
async function openRailPinned(page: Page, name: string, title: string): Promise<void> {
  await openBot(page, name)
  const pin = railRow(page, name).getByRole('button', { name: `Pin ${title}`, exact: true })
  await railRow(page, name).hover()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await pin.click()
  await expect(railGroup(page, 'Pinned').locator(`[data-bot="${name}"]`)).toBeVisible()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await railRow(page, name).hover()
  await pin.click()
  await expect(railGroup(page, 'Crew').locator(`[data-bot="${name}"]`)).toBeVisible()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  expect((await botState(page, name)).pinned).toBe(false)
  await railRow(page, name).hover()
  await pin.click()
  await expect(railGroup(page, 'Pinned').locator(`[data-bot="${name}"]`)).toBeVisible()
  await railRow(page, name).hover()
  await pillAtRest(page, name)
}

/** Hide the test bot from its row, show it again from Hidden, then hide it for the shot with Hidden open. */
async function openRailHidden(page: Page, name: string, title: string): Promise<void> {
  await openBot(page, name)
  const hide = () => railRow(page, name).getByRole('button', { name: `Hide ${title}`, exact: true })
  await railRow(page, name).hover()
  await hide().click()
  await expect(page.getByText('Bot hidden')).toBeVisible()
  await expect(railRow(page, name)).toHaveCount(0)
  await rail(page).getByRole('button', { name: /^Hidden \(\d+\)$/ }).click()
  const hidden = railGroup(page, /^Hidden \(\d+\)$/)
  await expect(hidden.locator(`[data-bot="${name}"]`)).toBeVisible()
  await hidden.locator(`[data-bot="${name}"]`).hover()
  await hidden.getByRole('button', { name: `Show ${title}`, exact: true }).click()
  await expect(page.getByText('Bot shown')).toBeVisible()
  await expect(railGroup(page, 'Crew').locator(`[data-bot="${name}"]`)).toBeVisible()
  expect((await botState(page, name)).hidden).toBe(false)
  await railRow(page, name).hover()
  await hide().click()
  await expect(hidden.locator(`[data-bot="${name}"]`)).toBeVisible()
  await hidden.locator(`[data-bot="${name}"]`).hover()
  await pillAtRest(page, name)
}

/** The footer's theme menu, open, with the current choice checked. Nothing is picked. */
async function openRailTheme(page: Page, name: string, theme: Ctx['theme']): Promise<void> {
  await openBot(page, name)
  await rail(page).getByRole('button', { name: 'Theme', exact: true }).click()
  await expect(page.getByRole('menuitemradio')).toHaveText(['System', 'Light', 'Dark'])
  await expect(page.getByRole('menuitemradio', { name: theme === 'dark' ? 'Dark' : 'Light' })).toHaveAttribute('aria-checked', 'true')
}

const SCREENS: Screen[] = [
  { id: 'workspace', task: 4, open: page => openBot(page, BOT) },
  { id: 'workspace-side', task: 6, open: page => openSide(page, BOT) },
  { id: 'profile', task: 6, open: page => openProfile(page, BOT, BOT_TITLE) },
  { id: 'rail', task: 7, open: page => openRailFind(page, BOT) },
  { id: 'rail-pinned', task: 7, open: page => openRailPinned(page, BOT, BOT_TITLE), teardown: ({ page }) => resetRailBot(page, BOT) },
  { id: 'rail-hidden', task: 7, open: page => openRailHidden(page, BOT, BOT_TITLE), teardown: ({ page }) => resetRailBot(page, BOT) },
  { id: 'rail-theme', task: 7, open: (page, { theme }) => openRailTheme(page, BOT, theme) }
]

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext()
  try {
    const made = await crewApi(await context.newPage(), 'POST', '/crew/bots', { name: BOT, title: BOT_TITLE, avatar: { type: 'circle' } })
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300)
  } finally {
    await context.close()
  }
})

test.afterAll(async ({ browser }) => {
  if (!E2E_BOT.test(BOT)) throw new Error(`refusing to delete ${BOT}: not a test bot`)
  const context = await browser.newContext()
  try {
    const gone = await crewApi(await context.newPage(), 'DELETE', `/crew/bots/${BOT}`)
    expect(gone.status, JSON.stringify(gone.body)).toBeLessThan(300)
  } finally {
    await context.close()
  }
})

for (const screen of SCREENS) {
  for (const theme of THEMES) {
    for (const size of sizes()) {
      test(`@task${screen.task} ${screen.id} ${theme} ${sizeLabel(size)}`, async ({ page }) => {
        const ctx: Ctx = { page, theme, size }
        const seen = await watch(page)
        await prepare(ctx)
        await screen.setup?.(ctx)
        try {
          await screen.open(page, ctx)
          await shoot(ctx, shotName(screen.task, screen.id))
          expect(seen.errors()).toEqual([])
          expect(await seen.csp()).toEqual([])
        } finally {
          await screen.teardown?.(ctx)
        }
      })
    }
  }
}
