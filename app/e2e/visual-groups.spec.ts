import { type Page, expect, test } from '@playwright/test'

import { CREW, crewApi } from './helpers.js'
import { deleteTestGroups, listGroups, waitSeatable } from './hermes-rpc.js'
import { type Ctx, THEMES, prepare, shoot, shotName, sizeLabel, sizes, watch } from './visual.js'

// The group screens of the UI 2 visual check (the harness is in visual.ts; see visual.spec.ts).
// Run with `npx playwright test visual-groups.spec.ts --grep @task15` on the deployed service.
// NO MODEL CALLS: nothing here sends a group message (the one "@" typed into the box opens the mention list
// and is cleared again). PRIVACY: the harness only guards `/bots/<name>` pages, and the user's real groups
// hold private chats, so every screen is this spec's own group, made from its own two `e2e<digits>` bots
// and checked by id before each shot. The group and both bots are deleted at the end.

const TASK = 15
const E2E_BOT = /^e2e\d+$/
const RUN = String(Math.floor(100000 + Math.random() * 800000))
const BOTS = [
  { name: `e2e${RUN}1`, title: `E2E Scout ${RUN}`, avatar: { type: 'circle' } },
  { name: `e2e${RUN}2`, title: `E2E Quill ${RUN}`, avatar: { type: 'square' } }
] as const
const GROUP = `E2E Group ${RUN}`
let roomId = ''

interface Screen {
  id: string
  open(page: Page): Promise<void>
}

interface StateRow { bots: { name: string }[]; groups?: { seatable: string[]; rooms: { id: string; name: string }[] } }

const sidePanel = (page: Page) => page.getByRole('region', { name: 'Panel' })
const box = (page: Page) => page.getByRole('textbox', { name: 'Message' })

function assertTestBots(): void {
  for (const bot of BOTS) if (!E2E_BOT.test(bot.name)) throw new Error(`refusing to use ${bot.name}: not a test bot`)
}

async function crewState(page: Page): Promise<StateRow> {
  return (await (await page.request.get(`${CREW}/crew/state`)).json()) as StateRow
}

/** The spec's one group, made once (through Crew, like the New group dialog does) and found again by the later tests. */
async function ensureGroup(page: Page): Promise<void> {
  assertTestBots()
  if (roomId) return
  await expect.poll(async () => {
    const state = await crewState(page)
    return BOTS.every(b => state.bots.some(row => row.name === b.name) && (state.groups?.seatable.includes(b.name) ?? false))
  }, { timeout: 60_000 }).toBe(true)
  const made = await crewApi(page, 'POST', '/crew/groups', { name: GROUP, members: BOTS.map(b => b.name) })
  expect(made.status, JSON.stringify(made.body)).toBe(201)
  roomId = String(made.body.roomId)
  await expect.poll(async () => (await crewState(page)).groups?.rooms.some(r => r.id === roomId) ?? false, { timeout: 30_000 }).toBe(true)
}

/** Refuses any page but this spec's own group: a real group's chat must never be in a shot. */
function assertOwnGroupPage(page: Page): void {
  const path = new URL(page.url()).pathname
  if (roomId === '' || path !== `/groups/${roomId}`) throw new Error(`refusing to shoot ${path}: only this spec's own group is shot`)
}

/** The group before its first message: its header, who is in it, and the composer with the who-will-answer line. */
async function openGroup(page: Page, panel = false): Promise<void> {
  await page.goto(`${CREW}/groups/${roomId}${panel ? '?panel=group' : ''}`)
  await expect(page.getByRole('heading', { name: GROUP, level: 2 })).toBeVisible()
  await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
  await expect(page.getByText(`Start with ${GROUP}`)).toBeVisible()
  await expect(page.getByTestId('member-message')).toHaveCount(0)
  await expect(box(page)).toBeEnabled()
  await expect(page.getByTestId('who-will-answer')).toHaveText('Auto will pick who replies')
}

/** The mention list over the composer. The "@" is typed, never sent. */
async function openMention(page: Page): Promise<void> {
  await openGroup(page)
  await box(page).fill('@')
  await expect(page.getByRole('listbox', { name: 'Mention a bot' })).toBeVisible()
  for (const bot of BOTS) await expect(page.getByRole('option', { name: new RegExp(bot.title) })).toBeVisible()
}

/** The details panel: rename, members, the reply rule, purpose, notes and the danger zone. */
async function openPanel(page: Page): Promise<void> {
  await openGroup(page, true)
  const panel = sidePanel(page)
  await expect(panel.getByRole('heading', { name: 'Group details' })).toBeVisible()
  await expect(panel.getByLabel('Group name')).toHaveValue(GROUP)
  for (const bot of BOTS) await expect(panel.getByRole('link', { name: new RegExp(bot.title) })).toBeVisible()
  await expect(panel.getByRole('radio', { name: /Auto/ })).toBeChecked()
  await expect(panel.getByRole('button', { name: 'Delete group' })).toBeVisible()
}

/**
 * The New group dialog over this spec's group, with its two bots picked. Every row carries `data-bot`, so the
 * harness masks the rows of bots that are not test bots; those rows are also taken out of the layout here,
 * because a mask covers a row's whole box even where the list has scrolled it out of view.
 */
async function openNewGroup(page: Page): Promise<void> {
  await openGroup(page)
  await page.getByRole('button', { name: 'New group' }).click()
  const dialog = page.getByRole('dialog', { name: 'New group' })
  await expect(dialog).toBeVisible()
  const unmarked = await dialog.getByRole('checkbox').evaluateAll(boxes => boxes.filter(el => el.closest('li[data-bot]') === null).length)
  expect(unmarked, 'dialog rows without data-bot').toBe(0)
  const own = BOTS.map(b => b.name)
  await dialog.locator('li[data-bot]').evaluateAll((rows, keep) => {
    for (const row of rows) if (!keep.includes(row.getAttribute('data-bot') ?? '')) (row as HTMLElement).style.display = 'none'
  }, own)
  await expect(dialog.locator('li[data-bot]:visible')).toHaveCount(BOTS.length)
  for (const bot of BOTS) {
    const pick = dialog.getByRole('checkbox', { name: bot.title })
    await pick.click()
    await expect(pick).toBeChecked()
  }
  await expect(dialog.getByRole('status')).toHaveText('2 of 6 picked')
  await expect(dialog.getByRole('button', { name: 'Create group' })).toBeEnabled()
}

const SCREENS: readonly Screen[] = [
  { id: 'group-chat', open: openGroup },
  { id: 'group-mention', open: openMention },
  { id: 'group-panel', open: openPanel },
  { id: 'new-group', open: openNewGroup }
]

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  assertTestBots()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    for (const bot of BOTS) {
      const made = await crewApi(page, 'POST', '/crew/bots', bot)
      expect(made.status, JSON.stringify(made.body)).toBeLessThan(300)
    }
    for (const bot of BOTS) await waitSeatable(bot.name, 60_000)
  } finally {
    await context.close()
  }
})

/** Deletes every spec bot, trying each one, then fails on the first that could not be deleted. */
async function deleteBots(page: Page): Promise<void> {
  const results = []
  for (const bot of BOTS) results.push(await crewApi(page, 'DELETE', `/crew/bots/${bot.name}`))
  for (const gone of results) expect(gone.status, JSON.stringify(gone.body)).toBeLessThan(300)
}

test.afterAll(async ({ browser }) => {
  assertTestBots()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    try {
      // Only rooms whose members are all test bots are ever disbanded.
      await deleteTestGroups()
      if (roomId) expect((await listGroups()).some(r => r.room_id === roomId), 'the spec group is gone').toBe(false)
    } finally {
      // The bots go even when the disband failed; that failure still fails the run once they are gone.
      await deleteBots(page)
    }
  } finally {
    await context.close()
  }
})

for (const screen of SCREENS) {
  for (const theme of THEMES) {
    for (const size of sizes()) {
      test(`@task${TASK} ${screen.id} ${theme} ${sizeLabel(size)}`, async ({ page }) => {
        const ctx: Ctx = { page, theme, size }
        const seen = await watch(page)
        await prepare(ctx)
        await ensureGroup(page)
        await screen.open(page)
        assertOwnGroupPage(page)
        await shoot(ctx, shotName(TASK, screen.id))
        expect(seen.errors()).toEqual([])
        expect(await seen.csp()).toEqual([])
      })
    }
  }
}
