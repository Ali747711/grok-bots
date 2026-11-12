import { type Page, expect, test } from '@playwright/test'

import { CREW, crewApi } from './helpers.js'
import { withRpc } from './hermes-rpc.js'
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

/**
 * The New bot panel, open, morphed out of the pill. On the way: a press outside keeps the draft, Esc drops
 * it, focus returns to the pill, and Tab stays inside the panel. No bot is created.
 */
async function openNewBot(page: Page, name: string): Promise<void> {
  await openBot(page, name)
  const pill = page.getByRole('button', { name: '+ New bot', exact: true })
  const panel = page.getByRole('dialog', { name: 'New bot' })
  const field = panel.getByLabel('Name', { exact: true })
  await pill.click()
  await expect(field).toBeFocused()
  await field.fill('E2E Draft')
  // The panel is modal, so the press lands on the page behind it, far from the panel.
  await page.mouse.click(page.viewportSize()!.width - 40, page.viewportSize()!.height - 40)
  await expect(panel).toHaveCount(0)
  await expect(pill).toBeFocused()
  await pill.click()
  await expect(field).toHaveValue('E2E Draft')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(pill).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(field).toBeFocused()
  await expect(field).toHaveValue('')
  await field.fill('E2E Draft')
  await expect(panel.getByText('@e2e-draft', { exact: true })).toBeVisible()
  // The radio itself is visually hidden under its tile, so the tile is what a user clicks.
  await panel.getByText('Engineer', { exact: true }).click()
  await expect(panel.getByRole('radio', { name: 'Engineer' })).toBeChecked()
  await panel.getByRole('button', { name: 'Create', exact: true }).focus()
  await page.keyboard.press('Tab')
  await expect(panel.getByRole('button', { name: 'Close', exact: true })).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(panel.getByRole('button', { name: 'Create', exact: true })).toBeFocused()
  await field.focus()
  // The morph is a spring that `shoot` cannot freeze: wait until the panel has its full width.
  await expect.poll(async () => Math.round((await panel.boundingBox())?.width ?? 0)).toBe(440)
}

/** The header's own controls, by their accessible names. */
const chatHeader = (page: Page) => page.getByRole('main').locator('header')

/**
 * The conversation beside the side panel, where it is narrowest (about 460 px at 1440): the title must keep
 * its room next to the status chip and the Computer, Routines and Profile icon buttons.
 */
async function openConversation(page: Page, name: string, title: string): Promise<void> {
  await openSide(page, name)
  const header = chatHeader(page)
  const titleButton = header.getByRole('heading', { name: title, exact: true }).getByRole('button', { name: title, exact: true })
  await expect(titleButton).toBeVisible()
  expect(await titleButton.evaluate(el => el.scrollWidth <= el.clientWidth), 'the title is not cut off').toBe(true)
  await expect(header.getByRole('button', { name: 'Computer', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(header.getByRole('button', { name: 'Routines', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(header.getByRole('button', { name: 'Profile', exact: true })).toBeVisible()
  await expect(header.getByText('Idle', { exact: true })).toBeVisible()
  await expect(page.getByRole('log')).toHaveAttribute('data-testid', 'transcript')
}

/** A new bot's conversation before its first message: the empty thread, whose button opens the profile. */
async function openEmptyThread(page: Page, name: string, title: string): Promise<void> {
  await openBot(page, name)
  const thread = page.getByTestId('transcript')
  await expect(thread.getByText(`Start with ${title}`, { exact: true })).toBeVisible()
  await thread.getByRole('button', { name: 'Set up profile', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/bots/${name}\\?panel=profile$`))
  await page.getByRole('button', { name: 'Back to chat' }).click()
  await expect(page).toHaveURL(new RegExp(`/bots/${name}$`))
  await expect(thread.getByText(`Start with ${title}`, { exact: true })).toBeVisible()
  // The Computer tooltip names its shortcut; it is closed again before the shot.
  await chatHeader(page).getByRole('button', { name: 'Computer', exact: true }).hover()
  const tip = page.locator('[data-slot="tooltip-content"]')
  await expect(tip).toContainText('Computer')
  await expect(tip).toContainText('\\')
  await page.mouse.move(0, 0)
  await expect(tip).toHaveCount(0)
}

/**
 * The composer with an unsent two-line draft: `/` focuses it, the box grows, and Send turns on. Nothing is
 * sent (no Enter, no click on Send), so no model is called.
 */
async function openComposer(page: Page, name: string): Promise<void> {
  await openBot(page, name)
  const box = page.getByRole('textbox', { name: 'Message' })
  const send = page.getByRole('button', { name: 'Send', exact: true })
  await expect(send).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
  const oneLine = (await box.boundingBox())?.height ?? 0
  await page.keyboard.press('/')
  await expect(box).toBeFocused()
  await expect(box).toHaveValue('')
  await box.fill('Draft a short plan for the launch\nand list what is still open')
  await expect(send).toBeEnabled()
  expect((await box.boundingBox())?.height ?? 0, 'the box grows with a second line').toBeGreaterThan(oneLine)
  // The draft is kept for this bot while the profile is open.
  await chatHeader(page).getByRole('button', { name: 'Profile', exact: true }).click()
  await page.getByRole('button', { name: 'Back to chat' }).click()
  await expect(box).toHaveValue(/and list what is still open$/)
  await box.focus()
}

/**
 * The Needs-you page with nothing waiting. A request card needs a real request from a model turn, which this
 * spec never makes; if the user has one open right now the screen fails here, before anything is shot.
 */
async function openNeedsYou(page: Page): Promise<void> {
  await page.goto(`${CREW}/needs-you`)
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { name: 'Needs you', exact: true })).toBeVisible()
  await expect(main.getByText('Nothing needs you right now.', { exact: true })).toBeVisible()
  await expect(page.getByTestId('request-card')).toHaveCount(0)
}

const sidePanel = (page: Page) => page.getByRole('region', { name: 'Panel' })
const linkChipText = (page: Page) => sidePanel(page).locator('[data-slot="side-chip"]').getByRole('status')

interface ScreenStatus { running: boolean; lease: { holder: string } }
const screenStatus = (name: string): Promise<ScreenStatus> => withRpc(rpc => rpc.call<ScreenStatus>('display.status', { profile: name }))

/** Start the test bot's screen the way the Start screen button does. Only ever the `e2e<digits>` bot. */
async function startScreen(page: Page, name: string): Promise<void> {
  if (!E2E_BOT.test(name)) throw new Error(`refusing to start ${name}'s screen: not a test bot`)
  if ((await screenStatus(name)).running) return
  const started = await crewApi(page, 'POST', `/crew/bots/${name}/screen/start`)
  expect(started.status, JSON.stringify(started.body)).toBeLessThan(300)
}

/** Stop the test bot's screen (and so end any control held on it). Only ever the `e2e<digits>` bot. */
async function stopScreen(name: string): Promise<void> {
  if (!E2E_BOT.test(name)) throw new Error(`refusing to stop ${name}'s screen: not a test bot`)
  await withRpc(rpc => rpc.call('display.stop', { profile: name, force: true })).catch(() => undefined)
}

/** The Screen tab with the screen off: the off copy, the start action, an idle Now strip and an empty log. */
async function openScreenOff(page: Page, name: string, title: string): Promise<void> {
  await openSide(page, name)
  const side = sidePanel(page)
  await expect(side.getByText(`${title}'s screen is off.`, { exact: true })).toBeVisible()
  await expect(side.getByText(/Files and open apps are saved/)).toHaveCount(0)
  await expect(linkChipText(page)).toHaveText('Off')
  await expect(side.locator('[data-slot="now-strip"] .sr-only')).toHaveText('Idle')
  await expect(side.getByRole('heading', { name: 'Recent actions', exact: true })).toBeVisible()
  await expect(side.getByText('No actions yet.', { exact: true })).toBeVisible()
}

/** The Screen tab on a running screen, connected and only watching: the chip says Live and Take control is on. */
async function openScreenLive(page: Page, name: string): Promise<void> {
  await page.goto(`${CREW}/bots/${name}?panel=computer`)
  const side = sidePanel(page)
  await expect(side.getByTestId('live-view')).toBeVisible({ timeout: 30_000 })
  await expect(side.getByRole('button', { name: 'Take control', exact: true })).toBeEnabled({ timeout: 30_000 })
  await expect(linkChipText(page)).toHaveText('Live')
  await expect(page.getByText("You're in control", { exact: true })).toHaveCount(0)
  // The picture has drawn: noVNC's canvas has a size.
  await expect.poll(() => side.getByTestId('live-view').locator('canvas').evaluate((c: HTMLCanvasElement) => c.width)).toBeGreaterThan(0)
}

/** The same screen with control taken through the UI: one "You're in control", in the header chip. */
async function openScreenControl(page: Page, name: string): Promise<void> {
  await openScreenLive(page, name)
  const side = sidePanel(page)
  await side.getByRole('button', { name: 'Take control', exact: true }).click()
  await expect(linkChipText(page)).toHaveText("You're in control")
  await expect(page.getByText("You're in control", { exact: true })).toHaveCount(1)
  await expect.poll(async () => (await screenStatus(name)).lease.holder).toBe('human')
  await expect(side.getByRole('button', { name: 'Stop screen', exact: true })).toBeDisabled()
  await expect(side.getByTestId('live-view')).toHaveClass(/ring-watermelon/)
  // Keep the pointer and the keyboard off the remote desktop for the shot.
  await page.mouse.move(0, 0)
}

/** Hand control back through the UI (when held), then stop the test bot's screen. */
async function leaveScreen(page: Page, name: string): Promise<void> {
  const handBack = sidePanel(page).getByRole('button', { name: 'Hand back', exact: true })
  if (await handBack.isVisible().catch(() => false)) {
    await handBack.click()
    await expect.poll(async () => (await screenStatus(name)).lease.holder).toBe('agent')
  }
  await stopScreen(name)
}

const SCREENS: Screen[] = [
  { id: 'workspace', task: 4, open: page => openBot(page, BOT) },
  { id: 'workspace-side', task: 6, open: page => openSide(page, BOT) },
  { id: 'profile', task: 6, open: page => openProfile(page, BOT, BOT_TITLE) },
  { id: 'rail', task: 7, open: page => openRailFind(page, BOT) },
  { id: 'rail-pinned', task: 7, open: page => openRailPinned(page, BOT, BOT_TITLE), teardown: ({ page }) => resetRailBot(page, BOT) },
  { id: 'rail-hidden', task: 7, open: page => openRailHidden(page, BOT, BOT_TITLE), teardown: ({ page }) => resetRailBot(page, BOT) },
  { id: 'rail-theme', task: 7, open: (page, { theme }) => openRailTheme(page, BOT, theme) },
  { id: 'new-bot', task: 8, open: page => openNewBot(page, BOT) },
  { id: 'conversation', task: 9, open: page => openConversation(page, BOT, BOT_TITLE) },
  { id: 'empty-thread', task: 9, open: page => openEmptyThread(page, BOT, BOT_TITLE) },
  { id: 'composer', task: 10, open: page => openComposer(page, BOT) },
  { id: 'needs-you', task: 10, open: page => openNeedsYou(page) },
  { id: 'screen-off', task: 11, setup: () => stopScreen(BOT), open: page => openScreenOff(page, BOT, BOT_TITLE) },
  { id: 'screen-live', task: 11, setup: ({ page }) => startScreen(page, BOT), open: page => openScreenLive(page, BOT), teardown: ({ page }) => leaveScreen(page, BOT) },
  { id: 'screen-control', task: 11, setup: ({ page }) => startScreen(page, BOT), open: page => openScreenControl(page, BOT), teardown: ({ page }) => leaveScreen(page, BOT) }
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
  await stopScreen(BOT)
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
