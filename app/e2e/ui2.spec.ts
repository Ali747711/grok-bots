import { type Page, expect, test } from '@playwright/test'

import { CREW, createBotInDialog, deleteTestBots, metaOf, rawConfigOf } from './helpers.js'

// UI 2: what the reskin added must reach Hermes and survive a reload. One test-owned bot
// (handle e2e<6 digits>), deleted before and after. No test here sends a message, so none spends a model call.
const run = String(Math.floor(100000 + Math.random() * 800000))
const handle = `e2e${run}`
const title = `E2E UI2 ${run}`

const rail = (page: Page) => page.getByRole('complementary')
const railRow = (page: Page) => page.locator(`[data-bot="${handle}"]`)
const tabPanel = (page: Page) => page.getByRole('main').getByRole('tabpanel')
const group = (page: Page, name: string) => tabPanel(page).getByRole('radiogroup', { name, exact: true })
/** The radio inputs are visually hidden: a choice is made by clicking its label, as a person does. */
const pick = (page: Page, legend: string, label: string) => group(page, legend).locator('label').filter({ hasText: label }).click()
const approvalsMode = async () => (await rawConfigOf(handle)).approvals?.mode
const disabledToolsets = async () => ((await rawConfigOf(handle)).agent?.disabled_toolsets ?? []) as string[]

async function openTab(page: Page, tab: 'identity' | 'avatar' | 'skills' | 'advanced', label: string): Promise<void> {
  await page.goto(`${CREW}/bots/${handle}?panel=profile&tab=${tab}`)
  await expect(page.getByRole('main').getByRole('tab', { name: label })).toHaveAttribute('aria-selected', 'true')
}

/** Pick a theme in the rail footer's menu. The menu stays open after a pick, so Esc closes it. */
async function chooseTheme(page: Page, label: 'System' | 'Light' | 'Dark'): Promise<void> {
  await rail(page).getByRole('button', { name: 'Theme', exact: true }).click()
  const item = page.getByRole('menuitemradio', { name: label, exact: true })
  await item.click()
  await expect(item).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitemradio')).toHaveCount(0)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async ({ browser }) => {
  await deleteTestBots()
  const page = await browser.newPage()
  await createBotInDialog(page, title, handle)
  await page.close()
})
test.afterAll(async () => {
  await deleteTestBots()
})

test('a pin from the rail reaches Hermes, and unpin stores pinned false', async ({ page }) => {
  await page.goto(`${CREW}/bots/${handle}`)
  const pin = railRow(page).getByRole('button', { name: `Pin ${title}`, exact: true })
  await railRow(page).hover()
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')
  await expect(rail(page).getByRole('group', { name: 'Pinned' }).locator(`[data-bot="${handle}"]`)).toBeVisible()
  await expect.poll(async () => (await metaOf(handle))?.pinned, { timeout: 30_000 }).toBe(true)

  await page.reload()
  await expect(rail(page).getByRole('group', { name: 'Pinned' }).locator(`[data-bot="${handle}"]`)).toBeVisible()
  await expect(pin).toHaveAttribute('aria-pressed', 'true')

  await railRow(page).hover()
  await pin.click()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
  await expect(rail(page).getByRole('group', { name: 'Crew' }).locator(`[data-bot="${handle}"]`)).toBeVisible()
  // The key stays, as false: a missing key would leave the Webapp's copy pinned.
  await expect.poll(async () => { const meta = await metaOf(handle); return meta !== undefined && 'pinned' in meta && meta.pinned }, { timeout: 30_000 }).toBe(false)

  await page.reload()
  await expect(rail(page).getByRole('group', { name: 'Crew' }).locator(`[data-bot="${handle}"]`)).toBeVisible()
  await expect(pin).toHaveAttribute('aria-pressed', 'false')
})

test('a theme choice from the rail footer survives a reload', async ({ page }) => {
  await page.goto(`${CREW}/bots/${handle}`)
  const html = page.locator('html')
  for (const [label, theme] of [['Dark', 'dark'], ['Light', 'light']] as const) {
    await chooseTheme(page, label)
    await expect(html).toHaveAttribute('data-theme', theme)
    await page.reload()
    await expect(rail(page).getByRole('button', { name: 'Theme', exact: true })).toBeVisible()
    await expect(html).toHaveAttribute('data-theme', theme)
  }
  // End on System, as a new browser starts.
  await chooseTheme(page, 'System')
})

test('a role and avatar accessories survive a reload and reach Hermes', async ({ page }) => {
  await openTab(page, 'identity', 'Identity')
  await tabPanel(page).getByText('Engineer', { exact: true }).click()
  await page.getByRole('main').getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await metaOf(handle))?.role, { timeout: 30_000 }).toBe('engineer')

  await openTab(page, 'avatar', 'Avatar')
  const bowTie = tabPanel(page).getByRole('switch', { name: 'Bow tie', exact: true })
  await pick(page, 'Hat', 'Crown')
  await expect.poll(async () => ((await metaOf(handle))?.crewAvatar as { hat?: string } | undefined)?.hat, { timeout: 30_000 }).toBe('crown')
  await bowTie.click()
  await expect.poll(async () => (await metaOf(handle))?.crewAvatar, { timeout: 30_000 }).toMatchObject({ hat: 'crown', bowTie: true })

  await page.reload()
  await expect(group(page, 'Hat').getByRole('radio', { name: 'Crown', exact: true })).toBeChecked()
  await expect(bowTie).toHaveAttribute('aria-checked', 'true')
  await openTab(page, 'identity', 'Identity')
  await expect(tabPanel(page).getByRole('radio', { name: 'Engineer' })).toBeChecked()
  expect(await metaOf(handle)).toMatchObject({ role: 'engineer', crewAvatar: { hat: 'crown', bowTie: true } })
})

test('an approvals choice reaches the bot\'s Hermes config', async ({ page }) => {
  await openTab(page, 'advanced', 'Advanced')
  const mode = (label: RegExp) => group(page, 'Approvals').getByRole('radio', { name: label })
  await expect(group(page, 'Approvals').getByRole('radio', { checked: true })).toHaveCount(1)
  // A new bot copies the primary's config. Should that already be "Never ask", move off it first so the confirm shows.
  if (await mode(/^Never ask/).isChecked()) {
    await pick(page, 'Approvals', 'Ask before risky commands')
    await expect.poll(approvalsMode, { timeout: 30_000 }).toBe('manual')
  }

  await pick(page, 'Approvals', 'Never ask')
  // Nothing is written before the confirm.
  expect(await approvalsMode()).not.toBe('off')
  await tabPanel(page).getByRole('group', { name: 'Turn off approvals?' }).getByRole('button', { name: 'Turn off approvals', exact: true }).click()
  await expect.poll(approvalsMode, { timeout: 30_000 }).toBe('off')
  await expect(mode(/^Never ask/)).toBeChecked()

  await pick(page, 'Approvals', 'Ask before risky commands')
  await expect.poll(approvalsMode, { timeout: 30_000 }).toBe('manual')
  await expect(mode(/^Ask before risky commands/)).toBeChecked()

  await pick(page, 'Approvals', 'Let a checker model decide first')
  await expect.poll(approvalsMode, { timeout: 30_000 }).toBe('smart')

  await page.reload()
  await expect(mode(/^Let a checker model decide first/)).toBeChecked()
})

test('a skills switch reaches agent.disabled_toolsets', async ({ page }) => {
  await openTab(page, 'skills', 'Skills')
  const vision = tabPanel(page).getByRole('switch', { name: 'Vision', exact: true })
  await expect(vision).toHaveAttribute('aria-checked', 'true')
  expect(await disabledToolsets()).not.toContain('vision')

  await vision.click()
  await expect(vision).toHaveAttribute('aria-checked', 'false')
  await expect.poll(disabledToolsets, { timeout: 30_000 }).toContain('vision')

  await vision.click()
  await expect(vision).toHaveAttribute('aria-checked', 'true')
  await expect.poll(disabledToolsets, { timeout: 30_000 }).not.toContain('vision')
})
