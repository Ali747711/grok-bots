import { type Page, expect, test } from '@playwright/test'

import { CREW, appsOff, appsStatus, crewApi, crewState, deleteTestBots, openBot, send, waitIdle } from './helpers.js'
import { profileRows, sessionMessages } from './hermes-rpc.js'

// SPENDS CREDIT: one real model turn (Haiku) on an e2e bot with GitHub at "Read and change". Every test is tagged @model.
// Controller-only, run ONCE, after the user has connected GitHub by hand and set E2E_GITHUB_LOGIN to that login.
// Implementers must never run this file (check it with --list only).

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const BOT = `e2e${stamp}`
const MIN_CREDIT = 0.12
const LOGIN = process.env.E2E_GITHUB_LOGIN ?? ''
const RECONNECT_MS = 150_000
const TURN_MS = 180_000

let page: Page
let created = false

test.beforeAll(async ({ browser }) => {
  test.skip(!LOGIN, 'E2E_GITHUB_LOGIN is not set')
  const ctx = await browser.newContext({ storageState: '.auth/crew.json' })
  page = await ctx.newPage()
  await page.goto(CREW)
  const list = await crewApi(page, 'GET', '/crew/connectors/apps')
  const github = (list.body?.apps as { toolkit: string; status: string }[] | undefined)?.find(a => a.toolkit === 'github')
  test.skip(github?.status !== 'connected', 'GitHub is not connected in Crew')
  const res = await crewApi(page, 'GET', '/crew/usage')
  const usage = (res.body ?? {}) as { state?: string; remaining?: number | null }
  // Fail closed: an unknown credit (stale, unavailable, not configured) skips the paid turn.
  test.skip(
    !(res.status === 200 && usage.state === 'ok' && typeof usage.remaining === 'number' && usage.remaining > MIN_CREDIT),
    'credit is unknown or at or below $0.12'
  )
  await deleteTestBots()
  const made = await crewApi(page, 'POST', '/crew/bots', {
    name: BOT,
    title: `E2E Apps Model ${stamp}`,
    avatar: { type: 'circle' },
    model: { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' }
  })
  expect(made.status).toBeLessThan(300)
  created = true
  const put = await crewApi(page, 'PUT', `/crew/bots/${BOT}/apps`, { github: 'change' })
  expect(put.status).toBe(200)
  const tools = (put.body.apps as { toolkit: string; tools: number }[]).find(a => a.toolkit === 'github')?.tools ?? -1
  await expect.poll(async () => {
    const status = await appsStatus(BOT)
    return status?.connected === true && status.tools === tools
  }, { timeout: RECONNECT_MS, intervals: [3000] }).toBe(true)
})

test.afterAll(async () => {
  if (page) {
    if (created) {
      await appsOff(page, BOT)
      const res = await crewApi(page, 'DELETE', `/crew/bots/${BOT}`)
      if (res.status !== 204) test.info().annotations.push({ type: 'delete-status', description: String(res.status) })
    }
    await page.context().close()
  }
  await deleteTestBots()
})

test('@model a read tool names the GitHub login, and a write tool waits for Allow once or Deny and is denied', async () => {
  test.setTimeout(300_000)
  const chat = (await profileRows()).find(p => p.name === BOT)?.canonical_session as { id?: string; resolved_id?: string } | null | undefined
  const sessionId = chat?.resolved_id ?? chat?.id
  expect(sessionId, 'the bot has a canonical session').toBeTruthy()
  await openBot(page, BOT)
  await send(page, `Use your GitHub app tools. First call GITHUB_GET_THE_AUTHENTICATED_USER. Then create an issue titled 'crew e2e please ignore' in ${LOGIN}/crew-e2e-does-not-exist. Report each tool result.`)

  let entry: { profile?: string; app?: unknown; choices?: string[] } | undefined
  await expect.poll(async () => {
    entry = ((await crewState(page)).pending as { profile?: string; app?: unknown; choices?: string[] }[]).find(p => p.profile === BOT)
    return entry !== undefined
  }, { timeout: TURN_MS, intervals: [2000] }).toBe(true)
  expect(entry?.app).toBeTruthy()
  expect(entry?.choices).toEqual(['once', 'deny'])

  const card = page.getByTestId('request-card').filter({ hasText: 'GITHUB_CREATE' })
  await expect(card).toBeVisible({ timeout: 30_000 })
  const buttons = card.getByRole('button')
  await expect(buttons).toHaveText(['Allow once', 'Deny'])
  await card.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(card).toBeHidden({ timeout: 15_000 })
  await waitIdle(page, BOT)

  const rows = await sessionMessages(BOT, sessionId!)
  expect(rows.filter(m => m.role === 'assistant').at(-1)?.content).toContain(LOGIN)
  expect(rows.filter(m => m.role === 'tool').map(m => m.content).join('\n')).toContain('did not approve')
})
