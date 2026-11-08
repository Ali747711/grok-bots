import { type Browser, type Page, expect, test } from '@playwright/test'

import { CREW, deleteTestBots, webappLoginUrl } from './helpers.js'
import { profileRow } from './hermes-rpc.js'

// A test-owned bot: handle e2e<6 digits>, deleted before and after.
const run = String(Math.floor(100000 + Math.random() * 800000))
const handle = `e2e${run}`
const title = `E2E Avatar ${run}`
const NAMESPACE = 'hermes-bots'

test.beforeAll(async () => {
  await deleteTestBots()
})
test.afterAll(async () => {
  await deleteTestBots()
})

async function webappBots(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()
  await page.goto(webappLoginUrl())
  await page.getByRole('tab', { name: 'Bots' }).click()
  return page
}

test('an avatar picked in Crew survives a reload and keeps the webapp in sync', async ({ page, browser }) => {
  await page.goto(CREW)
  await page.getByRole('button', { name: '+ New bot', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill(title)
  await page.getByRole('button', { name: 'Change handle', exact: true }).click()
  await page.getByLabel('Handle').fill(handle)
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/bots/${handle}$`), { timeout: 120_000 })

  await page.goto(`${CREW}/bots/${handle}?panel=profile`)
  await page.getByRole('button', { name: 'cat', exact: true }).click()
  await expect(page.getByRole('button', { name: 'cat', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Pink', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Pink', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // Both picks are saved straight away; wait until Hermes holds the last one.
  await expect.poll(async () => (await profileRow(handle))?.ui_meta?.[NAMESPACE]?.crewAvatar, { timeout: 30_000 }).toEqual({ type: 'cat', color: '#ff6fae' })

  await page.reload()
  await expect(page.getByRole('button', { name: 'cat', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Pink', exact: true })).toHaveAttribute('aria-pressed', 'true')

  const row = await profileRow(handle)
  expect(row?.ui_meta?.[NAMESPACE]).toMatchObject({ crewAvatar: { type: 'cat', color: '#ff6fae' }, shape: 'blob', color: '#ff6fae' })

  const webapp = await webappBots(browser)
  await expect(webapp.getByRole('button', { name: new RegExp(`^${title} · @${handle}`) })).toBeVisible({ timeout: 30_000 })
  await webapp.context().close()

  await page.getByRole('button', { name: 'Delete bot', exact: true }).click()
  await page.getByLabel(`Type ${handle} to confirm`).fill(handle)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page).toHaveURL(/\/bots\/default$/, { timeout: 60_000 })
})
