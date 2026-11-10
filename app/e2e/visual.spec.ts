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

const SCREENS: Screen[] = [
  { id: 'workspace', task: 4, open: page => openBot(page, BOT) },
  { id: 'workspace-side', task: 6, open: page => openSide(page, BOT) },
  { id: 'profile', task: 6, open: page => openProfile(page, BOT, BOT_TITLE) }
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
