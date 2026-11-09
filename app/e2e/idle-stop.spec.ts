import { expect, test } from '@playwright/test'

import { createBotInDialog, deleteTestBots } from './helpers.js'
import { hermesRest, withRpc } from './hermes-rpc.js'

// Slow (about 90 s): skip with `--grep-invert "idle stop"` when time-boxed. Test-owned bot only.
const run = String(Math.floor(100000 + Math.random() * 800000))
const handle = `e2e${run}`

test.beforeAll(async () => {
  await deleteTestBots()
})
test.afterAll(async () => {
  await withRpc(rpc => rpc.call('display.stop', { profile: handle, force: true })).catch(() => undefined)
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
