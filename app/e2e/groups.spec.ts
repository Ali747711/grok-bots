import { type Page, expect, test } from '@playwright/test'

import { CREW, deleteTestBots, webappLoginUrl } from './helpers.js'
import { createRoomViaRpc, createTestBot, deleteTestGroups, groupState, listGroups, waitSeatable } from './hermes-rpc.js'

// No model calls: nothing here ever sends a group message. Typing in the composer is fine; Enter outside the
// mention list is not, so every Enter below happens while the list is open (it inserts a handle instead).

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const BOT = `e2e${stamp}`
const GROUP = `E2E Group ${stamp}`
let roomId = ''

const sidebar = (page: Page) => page.getByRole('complementary')
const box = (page: Page) => page.getByRole('textbox', { name: 'Message' })
const line = (page: Page) => page.getByTestId('who-will-answer')

test.beforeAll(async () => {
  await createTestBot(BOT)
  await waitSeatable(BOT)
})

test.afterAll(async () => {
  await deleteTestGroups()
  await deleteTestBots()
})

test('a group made in Crew shows in the sidebar and in Hermes with Auto routing', async ({ page }) => {
  // Crew must know the new bot before the dialog can list it.
  await expect.poll(async () => {
    const state = (await (await page.request.get(`${CREW}/crew/state`)).json()) as { bots: { name: string }[]; groups?: { seatable: string[] } }
    return state.bots.some(b => b.name === BOT) && (state.groups?.seatable.includes(BOT) ?? false)
  }, { timeout: 30_000 }).toBe(true)
  await page.goto(CREW)
  await page.getByRole('button', { name: 'New group' }).click()
  await page.getByRole('checkbox', { name: 'Fixture' }).click()
  await page.getByRole('checkbox', { name: BOT }).click()
  await page.getByLabel('Group name').fill(GROUP)
  await page.getByRole('button', { name: 'Create group' }).click()
  await expect(page).toHaveURL(/\/groups\/[^/]+$/, { timeout: 30_000 })
  roomId = new URL(page.url()).pathname.split('/').pop()!
  await expect(sidebar(page).getByRole('button', { name: new RegExp(GROUP) })).toBeVisible()
  await expect.poll(async () => (await listGroups()).some(r => r.room_id === roomId && r.name === GROUP)).toBe(true)
  expect((await groupState(roomId)).context?.routing).toBe('auto')
})

test('a room made through Hermes appears in Crew; deleting it in Crew removes it from Hermes', async ({ page }) => {
  const name = `E2E Rpc ${stamp}`
  const rpcRoom = await createRoomViaRpc(name, ['crew-test', BOT])
  const started = Date.now()
  await page.goto(CREW)
  await expect(sidebar(page).getByRole('button', { name: new RegExp(name) })).toBeVisible({ timeout: 15_000 })
  test.info().annotations.push({ type: 'appeared-after-ms', description: String(Date.now() - started) })
  await page.goto(`${CREW}/groups/${rpcRoom}?panel=group`)
  await page.getByRole('button', { name: 'Delete group' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete group' }).click()
  await expect(page).toHaveURL(/\/bots\//, { timeout: 30_000 })
  await expect.poll(async () => (await listGroups()).some(r => r.room_id === rpcRoom), { timeout: 30_000 }).toBe(false)
})

test('mention autocomplete and the who-will-answer line (typed, never sent)', async ({ page }) => {
  await page.goto(`${CREW}/groups/${roomId}`)
  await expect(box(page)).toBeEnabled()
  await box(page).fill('@e2')
  await expect(page.getByRole('listbox')).toBeVisible()
  await expect(page.getByRole('option', { name: new RegExp(BOT) })).toBeVisible()
  await box(page).press('Enter')
  await expect(box(page)).toHaveValue(`@${BOT} `)

  await expect(line(page)).toHaveText(`@${BOT} will reply`)
  await box(page).fill('@crew-test hi')
  await expect(line(page)).toHaveText('@crew-test will reply')
  await box(page).fill(`@crew-test @${BOT}`)
  await expect(line(page)).toHaveText(`@crew-test and @${BOT} will reply`)
  await box(page).fill('@everyone')
  await expect(line(page)).toHaveText('Everyone (2 bots) will reply')
  await box(page).fill('@crew-test. hi')
  await expect(line(page)).toHaveText('Auto will pick who replies')
  await box(page).fill('hello')
  await expect(line(page)).toHaveText('Auto will pick who replies')
  await page.getByRole('button', { name: 'New topic' }).click()
  await expect(line(page)).toHaveText('New topic · Auto will pick who replies')
  await page.getByRole('button', { name: 'New topic' }).click()
  await box(page).fill('')
})

test('rename, reply rule, purpose and notes persist in Hermes', async ({ page }) => {
  await page.goto(`${CREW}/groups/${roomId}?panel=group`)
  const renamed = `${GROUP} B`
  await page.getByLabel('Group name').fill(renamed)
  await page.getByRole('button', { name: 'Rename' }).click()
  await expect.poll(async () => (await groupState(roomId)).room.name, { timeout: 30_000 }).toBe(renamed)

  await page.getByRole('radio', { name: /Everyone/ }).click()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await groupState(roomId)).context?.routing, { timeout: 30_000 }).toBe('everyone')

  await page.getByRole('radio', { name: /Auto/ }).click()
  await page.getByLabel('What this group is for').fill('Test purpose')
  await page.getByLabel('Notes for the bots').fill('Test notes')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => (await groupState(roomId)).context, { timeout: 30_000 }).toMatchObject({ routing: 'auto', purpose: 'Test purpose', notes: 'Test notes' })
})

test('a browser groups.* frame is refused; group routes need CSRF and our Origin', async ({ page }) => {
  await page.goto(CREW)
  const code = await page.evaluate(() => new Promise<number | string>(resolve => {
    const ws = new WebSocket(`ws://${location.host}/api/ws`)
    const timer = setTimeout(() => resolve('timeout'), 15_000)
    ws.onopen = () => ws.send(JSON.stringify({ jsonrpc: '2.0', id: 4242, method: 'groups.list', params: { profile: 'default' } }))
    ws.onmessage = event => {
      const msg = JSON.parse(String(event.data)) as { id?: number; error?: { code: number } }
      if (msg.id !== 4242) return
      clearTimeout(timer)
      ws.close()
      resolve(msg.error?.code ?? 'no-error')
    }
  }))
  expect(code).toBe(-32601)

  const body = { members: ['crew-test', BOT] }
  const noCsrf = await page.request.post(`${CREW}/crew/groups`, { data: body, headers: { Origin: CREW } })
  expect(noCsrf.status()).toBe(403)
  const token = (await page.context().cookies()).find(c => c.name === 'crew_csrf')?.value ?? ''
  const foreign = await page.request.post(`${CREW}/crew/groups`, { data: body, headers: { Origin: 'http://evil.example', 'X-Crew-CSRF': token } })
  expect(foreign.status()).toBe(403)
  expect((await listGroups()).filter(r => r.members.some(m => m.profile === BOT))).toHaveLength(1)
})

test('the official Webapp shows the Crew-made group', async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()
  await page.goto(webappLoginUrl())
  await page.getByRole('tab', { name: 'Bots' }).click()
  const row = page.getByText(`${GROUP} B`).first()
  await expect(row).toBeVisible({ timeout: 30_000 })
  // Element crop: only the group row is captured, never the user's bots.
  await row.screenshot({ path: '../../docs/phase4/webapp-group-row.png' })
  await ctx.close()
})
