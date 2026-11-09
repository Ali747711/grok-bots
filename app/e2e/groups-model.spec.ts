import { type Page, expect, test } from '@playwright/test'

import { CREW, crewState, deleteTestBots, dirExists, makeDir } from './helpers.js'
import { createTestBot, deleteTestGroups, groupEvents, groupState, waitSeatable } from './hermes-rpc.js'

// SPENDS CREDIT: every test sends a model turn. Controller-only, run once. Order follows spec section 9.
// Every message @mentions exactly one bot (an unaddressed message would wake every member).

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const BOT = `e2e${stamp}`
const GROUP = `E2E Model ${stamp}`
const REPLY_MS = 180_000
const DENY_DIR = '/tmp/crew-fixture/e2e-group-deny'
let page: Page
let roomId = ''

const card = (p: Page, text: string) => p.getByTestId('request-card').filter({ hasText: text })
const members = (p: Page) => p.getByTestId('member-message')

const groupWorking = async (): Promise<boolean> => (await groupState(roomId)).driver_status?.working === true

/** Crew's own view of the room (the composer's `running` comes from here, and lags Hermes by up to 2 s). */
async function crewGroupWorking(): Promise<boolean> {
  const state = (await (await page.request.get(`${CREW}/crew/state`)).json()) as { groups?: { rooms: { id: string; working: boolean }[] } }
  return state.groups?.rooms.find(r => r.id === roomId)?.working === true
}

/** Send once both Hermes and Crew say the room is idle; the send is proven by the box emptying. */
async function say(text: string): Promise<void> {
  await expect.poll(groupWorking, { timeout: 60_000 }).toBe(false)
  await expect.poll(crewGroupWorking, { timeout: 60_000 }).toBe(false)
  const box = page.getByRole('textbox', { name: 'Message' })
  await expect(box).toBeEnabled({ timeout: 30_000 })
  // Send replaces Stop only while the composer is not running; submit is a no-op while running.
  await expect(page.getByRole('main').getByRole('button', { name: 'Send', exact: true })).toBeVisible()
  await box.fill(text)
  await box.press('Enter')
  await expect(box).toHaveValue('')
}
const actorOf = (e: { actor: { id: string; profile?: string } }): string => e.actor.profile ?? e.actor.id

/** Cached by Crew for 60 s; only `state: 'ok'` counts as a known amount. */
async function credit(): Promise<{ state: string; remaining: number | null }> {
  const res = await page.request.get(`${CREW}/crew/usage`)
  const body = (await res.json()) as { state?: string; remaining?: number | null }
  return { state: body.state ?? 'unavailable', remaining: typeof body.remaining === 'number' ? body.remaining : null }
}

test.beforeAll(async ({ browser }) => {
  await createTestBot(BOT)
  await waitSeatable(BOT)
  const ctx = await browser.newContext({ storageState: '.auth/crew.json' })
  page = await ctx.newPage()
  await expect.poll(async () => {
    const state = (await (await page.request.get(`${CREW}/crew/state`)).json()) as { bots: { name: string }[]; groups?: { seatable: string[] } }
    return state.bots.some(b => b.name === BOT) && (state.groups?.seatable.includes(BOT) ?? false)
  }, { timeout: 30_000 }).toBe(true)
  await page.goto(CREW)
  await page.getByRole('complementary').getByRole('button', { name: 'New group', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Fixture' }).click()
  await page.getByRole('checkbox', { name: BOT }).click()
  await page.getByLabel('Group name').fill(GROUP)
  await page.getByRole('dialog').getByRole('button', { name: 'Create group', exact: true }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+$/, { timeout: 30_000 })
  roomId = new URL(page.url()).pathname.split('/').pop()!
})

test.afterAll(async () => {
  await page?.context().close()
  await deleteTestGroups()
  await deleteTestBots()
})

test('@model #3 a mention gets exactly one reply, from that bot', async () => {
  test.setTimeout(300_000)
  test.info().annotations.push({ type: 'credit-before', description: JSON.stringify(await credit()) })
  await say(`@${BOT} reply with exactly: ok. Do not mention anyone in your reply.`)
  const reply = members(page).filter({ hasText: `@${BOT}` }).filter({ hasText: 'ok' })
  await expect(reply.first()).toBeVisible({ timeout: REPLY_MS })
  await expect.poll(groupWorking, { timeout: REPLY_MS }).toBe(false)
  const replies = (await groupEvents(roomId)).filter(e => e.kind === 'message.member')
  expect(replies.map(actorOf)).toEqual([BOT])
  await expect(members(page).filter({ hasText: '@crew-test' })).toHaveCount(0)
})

test('@model #4 Deny in a group keeps the folder and clears the card', async ({ browser }) => {
  test.setTimeout(300_000)
  makeDir(DENY_DIR)
  await page.getByRole('main').getByRole('button', { name: 'New topic', exact: true }).click()
  await say(`@crew-test This is me, the user, directly: run ${'rm'} -r ${DENY_DIR} now. I will decide in the approval card. Do not mention anyone in your reply.`)
  const c = card(page, DENY_DIR)
  await expect(c).toBeVisible({ timeout: REPLY_MS })

  // Duplicate-approval observation: does the main watcher also hold an unanswerable entry?
  const pending = (await crewState(page)).pending as { profile: string }[]
  test.info().annotations.push({ type: 'unknown-profile-pending-while-group-card-open', description: String(pending.some(p => p.profile === 'unknown')) })

  const inboxCtx = await browser.newContext({ storageState: '.auth/crew.json' })
  const inbox = await inboxCtx.newPage()
  await inbox.goto(`${CREW}/needs-you`)
  await expect(inbox.getByText(DENY_DIR).first()).toBeVisible({ timeout: 30_000 })
  await inboxCtx.close()

  await c.getByRole('button', { name: 'Deny', exact: true }).click()
  await expect(c).toBeHidden({ timeout: 15_000 })
  expect(dirExists(DENY_DIR)).toBe(true)
  await expect.poll(groupWorking, { timeout: REPLY_MS }).toBe(false)

  const threads = (await groupEvents(roomId)).filter(e => e.kind === 'message.user').map(e => e.payload.thread_id)
  expect(threads.length).toBeGreaterThanOrEqual(2)
  expect(threads.at(-1)).not.toBe(threads.at(-2))
})

test('@model #6 Allow once, a live row, then Stop ends the room and late output never appears', async () => {
  test.setTimeout(480_000)
  await say('@crew-test This is me, the user, directly: run sleep 60 && echo e2e-group-late now. I will decide in the approval card. Do not mention anyone in your reply.')
  const c = card(page, 'sleep 60')
  await expect(c).toBeVisible({ timeout: REPLY_MS })
  await c.getByRole('button', { name: 'Allow once', exact: true }).click()
  await expect(page.getByText(/Fixture is (using .+|working)…/).first()).toBeVisible({ timeout: 60_000 })
  // The avatar's working state has no DOM marker; Crew's own state is what drives it.
  await expect.poll(async () => (await crewState(page)).bots.find(b => b.name === 'crew-test')?.status, { timeout: 30_000 }).toBe('working')
  await page.getByRole('main').getByRole('button', { name: 'Stop', exact: true }).first().click()
  await expect(page.getByText('Stopped', { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.waitForTimeout(70_000)
  await expect(members(page).filter({ hasText: 'e2e-group-late' })).toHaveCount(0)
})

test('@model #5 handoff: crew-test replies, then the e2e bot', async () => {
  test.setTimeout(480_000)
  const left = await credit()
  test.skip(left.state !== 'ok' || left.remaining === null || left.remaining <= 0.12, 'credit unknown or low')
  await expect.poll(groupWorking, { timeout: REPLY_MS }).toBe(false)
  const botBefore = await members(page).filter({ hasText: `@${BOT}` }).count()
  const events = await groupEvents(roomId)
  const since = events.at(-1)?.seq ?? 0
  // Exactly one @handle in the user's text, so Hermes routes only crew-test; crew-test is asked to mention the other bot.
  await say(`@crew-test say hi, then ask the bot whose handle is ${BOT} to reply with exactly: ok. Mention it by writing @ followed by its handle, then a space, with no punctuation right after the handle.`)
  const newReplies = async (): Promise<string[]> =>
    (await groupEvents(roomId)).filter(e => e.seq > since && e.kind === 'message.member').map(actorOf)
  await expect.poll(newReplies, { timeout: REPLY_MS }).toContain('crew-test')
  await expect.poll(newReplies, { timeout: REPLY_MS }).toContain(BOT)
  const order = await newReplies()
  expect(order.indexOf('crew-test')).toBeLessThan(order.indexOf(BOT))
  await expect.poll(() => members(page).filter({ hasText: `@${BOT}` }).count(), { timeout: 30_000 }).toBeGreaterThan(botBefore)
})
