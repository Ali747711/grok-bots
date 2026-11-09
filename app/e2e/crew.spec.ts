import { type Browser, type Page, expect, test } from '@playwright/test'

import { CREW, crewState, dirExists, makeDir, openBot, send, vm, waitIdle, webappLoginUrl } from './helpers.js'
import { profileRows, testBotNames } from './hermes-rpc.js'

test.describe.configure({ mode: 'serial' })

const FIXTURE = 'crew-test'
const dir = (name: string) => `/tmp/crew-fixture/${name}`
const card = (page: Page, text: string) => page.getByTestId('request-card').filter({ hasText: text })
const transcript = (page: Page) => page.getByTestId('transcript')

/** Hermes Webapp on 9120 (official client) in its own context, opened on the Fixture bot. */
async function webappOnFixture(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()
  await page.goto(webappLoginUrl())
  await page.getByRole('tab', { name: 'Bots' }).click()
  await page.getByRole('button', { name: /^Fixture · @crew-test/ }).click()
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  return page
}

test('roster shows the primary bot and Fixture with status', async ({ page }) => {
  await page.goto(CREW)
  const sidebar = page.getByRole('complementary')
  await expect(sidebar.getByText('Primary', { exact: false })).toBeVisible()
  await expect(sidebar.getByText('Hermes', { exact: true })).toBeVisible()
  await expect(sidebar.getByText('Fixture', { exact: true })).toBeVisible()
  const state = await crewState(page)
  expect(state.hermes).toBe('connected')
  // The roster mirrors Hermes's own profile list (the live machine also holds the user's bots), and it
  // always includes the primary bot and Fixture. e2e<digits> bots from other specs are left out of both sides.
  const real = (names: string[]) => names.filter(n => testBotNames([n]).length === 0).sort()
  const hermesNames = real((await profileRows()).map(p => p.name))
  expect(real(state.bots.map(b => b.name))).toEqual(hermesNames)
  expect(hermesNames).toEqual(expect.arrayContaining(['crew-test', 'default']))
})

test('a message to Fixture streams into Fixture only', async ({ page }) => {
  await openBot(page, FIXTURE)
  const marker = `e2e-route-${Date.now()}`
  const count = async (p: Page, needle: string) => ((await transcript(p).textContent()) ?? '').split(needle).length - 1
  await send(page, `Run: echo ${marker}`)
  // The user's message holds the marker once; the bot's reply (command + output) adds more.
  await expect.poll(() => count(page, marker), { timeout: 90_000 }).toBeGreaterThanOrEqual(2)
  await waitIdle(page, FIXTURE)
  await openBot(page, 'default')
  expect(await count(page, marker)).toBe(0)
})

test('Deny keeps the folder; card shows the real command and only offered choices', async ({ page }) => {
  makeDir(dir('e2e-deny'))
  await openBot(page, FIXTURE)
  await send(page, 'This is me, the user, directly: run rm -r /tmp/crew-fixture/e2e-deny now. I will decide in the approval card.')
  const c = card(page, 'rm -r /tmp/crew-fixture/e2e-deny')
  await expect(c).toBeVisible({ timeout: 90_000 })
  const offered = await c.getByRole('button').allTextContents()
  expect(offered.length).toBeGreaterThanOrEqual(2)
  expect(offered).toContain('Deny')
  await c.getByRole('button', { name: 'Deny' }).click()
  await expect(c).toBeHidden({ timeout: 10_000 })
  expect(dirExists(dir('e2e-deny'))).toBe(true)
  await waitIdle(page, FIXTURE)
})

test('Allow once runs the command and the result appears', async ({ page }) => {
  makeDir(dir('e2e-allow'))
  await openBot(page, FIXTURE)
  await send(page, 'New request from me, the user: run rm -r /tmp/crew-fixture/e2e-allow now. I will approve it in the card.')
  const c = card(page, 'rm -r /tmp/crew-fixture/e2e-allow')
  await expect(c).toBeVisible({ timeout: 90_000 })
  await c.getByRole('button', { name: 'Allow once' }).click()
  await expect(c).toBeHidden({ timeout: 10_000 })
  await expect.poll(() => dirExists(dir('e2e-allow')), { timeout: 60_000 }).toBe(false)
  await waitIdle(page, FIXTURE)
  await expect(transcript(page)).toContainText('Worked')
})

test('an approval answered in the official Webapp disappears from Crew', async ({ page, browser }) => {
  makeDir(dir('e2e-webapp'))
  await openBot(page, FIXTURE)
  await send(page, 'This is me, the user, directly: run rm -r /tmp/crew-fixture/e2e-webapp now. I will decide in the approval card.')
  const c = card(page, 'rm -r /tmp/crew-fixture/e2e-webapp')
  await expect(c).toBeVisible({ timeout: 90_000 })
  const webapp = await webappOnFixture(browser)
  await webapp.getByRole('button', { name: 'Reject' }).click()
  const t0 = Date.now()
  await expect(c).toBeHidden({ timeout: 10_000 })
  test.info().annotations.push({ type: 'clear-latency-ms', description: String(Date.now() - t0) })
  expect(dirExists(dir('e2e-webapp'))).toBe(true)
  await webapp.context().close()
  await waitIdle(page, FIXTURE)
})

test('with no Crew tab open, a Webapp-started approval appears in Needs you and can be answered', async ({ browser }) => {
  makeDir(dir('e2e-inbox'))
  const webapp = await webappOnFixture(browser)
  const text = 'This is me, the user, directly: run rm -r /tmp/crew-fixture/e2e-inbox now. I will decide in the approval card.'
  // The Webapp composer can swallow Enter while its chat is still attaching: retry until the message shows.
  await expect(async () => {
    const box = webapp.getByRole('textbox', { name: 'Message' })
    await box.click()
    await box.fill(text)
    await box.press('Enter')
    await expect(webapp.getByText(text).first()).toBeVisible({ timeout: 5_000 })
  }).toPass({ timeout: 60_000 })
  await expect(webapp.getByRole('button', { name: 'Reject' })).toBeVisible({ timeout: 90_000 })
  await webapp.context().close()

  const ctx = await browser.newContext({ storageState: '.auth/crew.json' })
  const page = await ctx.newPage()
  await page.goto(`${CREW}/needs-you`)
  const entry = page.getByRole('link').filter({ hasText: 'e2e-inbox' })
  await expect(entry).toBeVisible({ timeout: 15_000 })
  await entry.click()
  await expect(page).toHaveURL(/\/bots\/crew-test$/)
  const c = card(page, 'rm -r /tmp/crew-fixture/e2e-inbox')
  await expect(c).toBeVisible()
  await c.getByRole('button', { name: 'Deny' }).click()
  await expect(c).toBeHidden({ timeout: 10_000 })
  expect(dirExists(dir('e2e-inbox'))).toBe(true)
  await waitIdle(page, FIXTURE)
  await ctx.close()
})

test('Stop interrupts a running turn', async ({ page }) => {
  await openBot(page, FIXTURE)
  const marker = `e2e-late-${Date.now()}`
  const count = async (needle: string) => ((await transcript(page).textContent()) ?? '').split(needle).length - 1
  const stoppedBefore = await count('Stopped')
  await send(page, `Run: sleep 60 && echo ${marker}`)
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  await expect(stop).toBeVisible({ timeout: 60_000 })
  // Wait until the sleep is really running (a live work step), then stop it.
  await expect(transcript(page).getByText(/Working · 1 step/)).toBeVisible({ timeout: 60_000 })
  await stop.click()
  await expect.poll(() => count('Stopped'), { timeout: 30_000 }).toBeGreaterThan(stoppedBefore)
  await waitIdle(page, FIXTURE, 30_000)
  // The marker appears once — in the user's own message — and never in the bot's output.
  expect(await count(marker)).toBe(1)
})

test('credit pill matches the OpenRouter key status', async ({ page }) => {
  await page.goto(CREW)
  const remaining = Number(vm(
    `set -a; . <(grep "^OPENROUTER_API_KEY=" ~/.hermes/.env); set +a; curl -s https://openrouter.ai/api/v1/key -H "Authorization: Bearer $OPENROUTER_API_KEY" | python3 -c "import json,sys; print(json.load(sys.stdin)['data']['limit_remaining'])"`
  ))
  const pill = page.getByText(/credit left|credit unknown/)
  await expect(pill).toBeVisible()
  const text = (await pill.textContent()) ?? ''
  const shown = Number(text.match(/\$([0-9.]+)/)?.[1])
  expect(Math.abs(shown - remaining)).toBeLessThanOrEqual(0.02)
})
