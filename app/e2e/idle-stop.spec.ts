import { expect, test } from '@playwright/test'

import { CREW, createBotInDialog, deleteTestBots, rawConfigOf } from './helpers.js'
import { hermesRest, withRpc } from './hermes-rpc.js'

// Slow (about 90 s): skip with `--grep-invert "idle stop"` when time-boxed. Test-owned bot only.
const run = String(Math.floor(100000 + Math.random() * 800000))
const handle = `e2e${run}`
// The sleep test's own bot: the idle-stop test leaves its bot on a 1-minute window.
const sleepHandle = `e2e${Number(run) + 1}`
const sleepMinutes = async () => (await rawConfigOf(sleepHandle)).bot_desktop?.idle_stop_minutes

test.beforeAll(async () => {
  await deleteTestBots()
})
test.afterAll(async () => {
  for (const profile of [handle, sleepHandle]) await withRpc(rpc => rpc.call('display.stop', { profile, force: true })).catch(() => undefined)
  await deleteTestBots()
})

test('idle stop: a 1-minute window stops the screen even while thumbnails keep polling', async ({ page }) => {
  test.setTimeout(300_000)
  await createBotInDialog(page, `E2E Idle ${run}`, handle)
  // The same sparse write Crew uses, with a 1-minute window.
  const put = await hermesRest('PUT', `/api/config?profile=${handle}`, { config: { bot_desktop: { idle_stop_minutes: 1 } } })
  expect(put.status).toBe(200)
  const stoppedAfterMs = await withRpc(async rpc => {
    await rpc.call('display.start', { profile: handle })
    const began = Date.now()
    while (Date.now() - began < 150_000) {
      await rpc.call('display.thumbnail', { profile: handle }) // does not count as activity
      const { running } = await rpc.call<{ running: boolean }>('display.status', { profile: handle })
      if (!running) return Date.now() - began
      await new Promise(r => setTimeout(r, 4000))
    }
    return null
  })
  test.info().annotations.push({ type: 'idle stop fired after', description: stoppedAfterMs === null ? 'never (150 s)' : `${Math.round(stoppedAfterMs / 1000)} s` })
  expect(stoppedAfterMs).not.toBeNull()
})

test('a 1-hour sleep choice survives a screen start', async ({ page }) => {
  await createBotInDialog(page, `E2E Sleep ${run}`, sleepHandle)
  await page.goto(`${CREW}/bots/${sleepHandle}?panel=profile&tab=advanced`)
  const sleep = page.getByRole('main').getByRole('tabpanel').getByRole('radiogroup', { name: 'Stop the screen after' })
  await expect(sleep.getByRole('radio', { checked: true })).toHaveCount(1)
  // A new bot copies the primary's config, which may already be on 1 hour: choose 15 min first, so the 1-hour write is a real change.
  // The input is visually hidden: the choice is made by clicking its label.
  await sleep.locator('label').filter({ hasText: '15 min' }).click()
  await expect(sleep.getByRole('radio', { name: '15 min', exact: true })).toBeChecked()
  await expect.poll(sleepMinutes, { timeout: 30_000 }).toBe(15)
  await sleep.locator('label').filter({ hasText: '1 hour' }).click()
  await expect(sleep.getByRole('radio', { name: '1 hour', exact: true })).toBeChecked()
  await expect.poll(sleepMinutes, { timeout: 30_000 }).toBe(60)

  // Crew writes 15 at a start only when no choice is stored; the 1-hour choice must stay.
  await page.goto(`${CREW}/bots/${sleepHandle}?panel=computer`)
  await page.getByRole('button', { name: 'Start screen', exact: true }).click()
  await expect(page.getByTestId('live-view')).toBeVisible({ timeout: 30_000 })
  expect(await sleepMinutes()).toBe(60)
})
