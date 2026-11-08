import { type Page, expect, test } from '@playwright/test'

import { CREW, createBotInDialog, deleteTestBots } from './helpers.js'
import { hermesRest, withRpc } from './hermes-rpc.js'

// A test-owned bot: handle e2e<6 digits>, deleted (and its screen stopped) before and after.
const run = String(Math.floor(100000 + Math.random() * 800000))
const handle = `e2e${run}`
const title = `E2E Computer ${run}`

interface Lease { holder: string }
interface Status { running: boolean; lease: Lease }

const status = (): Promise<Status> => withRpc(rpc => rpc.call<Status>('display.status', { profile: handle }))
const rawConfig = async (): Promise<Record<string, Record<string, unknown>>> =>
  (await hermesRest('GET', `/api/config?profile=${handle}&include_defaults=false`)).body as Record<string, Record<string, unknown>>

async function stopScreen(): Promise<void> {
  await withRpc(rpc => rpc.call('display.stop', { profile: handle, force: true })).catch(() => undefined)
}

test.describe.configure({ mode: 'serial' })
test.beforeAll(async () => {
  await deleteTestBots()
})
test.afterAll(async () => {
  await stopScreen()
  await deleteTestBots()
})

const canvasHasPixels = (page: Page) => page.evaluate(() => {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="live-view"] canvas')
  if (!canvas || canvas.width === 0) return 0
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  let lit = 0
  for (let i = 0; i < data.length; i += 4 * 97) if (data[i]! + data[i + 1]! + data[i + 2]! > 0) lit += 1
  return lit
})

test('start the screen from the Computer tab and see it draw', async ({ page }) => {
  await createBotInDialog(page, title, handle)
  await page.goto(`${CREW}/bots/${handle}?panel=computer`)
  await page.getByRole('button', { name: 'Start screen', exact: true }).click()
  await expect(page.getByTestId('live-view')).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => canvasHasPixels(page), { timeout: 30_000 }).toBeGreaterThan(100)
  expect((await status()).running).toBe(true)
})

test('a Crew-started screen has the 15-minute idle stop in its config', async () => {
  expect((await rawConfig()).bot_desktop?.idle_stop_minutes).toBe(15)
})

test('take control, expand, close and hand back follow the lease', async ({ page }) => {
  await page.goto(`${CREW}/bots/${handle}?panel=computer`)
  await expect(page.getByRole('button', { name: 'Take control', exact: true })).toBeEnabled({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Take control', exact: true }).click()
  await expect(page.getByText("You're in control")).toBeVisible()
  await expect.poll(async () => (await status()).lease.holder).toBe('human')
  await page.getByRole('button', { name: 'Expand the screen', exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect.poll(() => page.evaluate(() => !!document.querySelector('[role=dialog] canvas'))).toBe(true)
  await page.getByRole('button', { name: 'Close expanded view', exact: true }).click()
  await expect(page.getByText("You're in control")).toBeVisible({ timeout: 20_000 })
  expect((await status()).lease.holder).toBe('human')
  await page.getByRole('button', { name: 'Hand back', exact: true }).click()
  await expect.poll(async () => (await status()).lease.holder).toBe('agent')
})

test('the header thumbnail appears with the Computer tab closed', async ({ page }) => {
  await page.goto(`${CREW}/bots/${handle}?panel=computer`)
  await expect(page.getByTestId('live-view')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Close panel', exact: true }).click()
  await expect(page.getByRole('img', { name: `${title}'s screen` })).toBeVisible({ timeout: 20_000 })
})

test('the use-screen switch round-trips both config keys', async ({ page }) => {
  await page.goto(`${CREW}/bots/${handle}?panel=computer`)
  const toggle = page.getByRole('switch', { name: `Let ${title} use its screen` })
  await expect(toggle).toBeEnabled({ timeout: 30_000 })
  await toggle.click()
  await expect.poll(async () => { const c = await rawConfig(); return [c.browser?.headed, c.bot_desktop?.auto_start] }).toEqual([true, true])
  await toggle.click()
  await expect.poll(async () => { const c = await rawConfig(); return [c.browser?.headed, c.bot_desktop?.auto_start] }).toEqual([false, false])
})

test('stop the screen', async ({ page }) => {
  await page.goto(`${CREW}/bots/${handle}?panel=computer`)
  await page.getByRole('button', { name: 'Stop screen', exact: true }).click()
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start screen', exact: true })).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => (await status()).running).toBe(false)
})
