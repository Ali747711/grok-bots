import { type Browser, type Page, expect, test } from '@playwright/test'

import { CREW, crewApi, expandRoutine, githubHeaders, postHook } from './helpers.js'
import { type Ctx, THEMES, prepare, shoot, shootLogin, shotName, sizeLabel, sizes, watch } from './visual.js'

// The dialogs and the login page of the UI 2 visual check (the harness is in visual.ts; see visual.spec.ts).
// Run with `npx playwright test visual-dialogs.spec.ts --grep @task16` on the deployed service.
// NO MODEL CALLS: the routine is "Only when triggered" and the two events sent to its trigger are ones Crew
// drops before any run (a wrong signature, and an event type the filter refuses). Nothing is confirmed:
// Delete bot stays open with an empty field, and no app is connected or disconnected.
// PRIVACY: Apps lists the user's own connected apps and Settings holds the Composio key row and the credit
// line; the harness masks all three, and each screen below checks its marks are there before the shot.
// NO SECRETS: nothing is ever typed into the key field, the trigger's one-time secret stays in memory and is
// never shown or printed, and the login page is shot signed out, with no ticket in the link.

const TASK = 16
const E2E_BOT = /^e2e\d+$/
const RUN = String(Math.floor(100000 + Math.random() * 800000))
const BOT = `e2e${RUN}`
const BOT_TITLE = `E2E Dialogs ${RUN}`
const ON_EVENT = `E2E On event ${RUN}`
const TRIGGER = `E2E GitHub ${RUN}`

interface Screen {
  id: string
  setup?(page: Page): Promise<void>
  open(page: Page): Promise<void>
}

interface RoutineRow { id: string; title: string }
interface TriggerRow { id: string; name: string }
interface EventRow { outcome: string }

/** True once this run has made the trigger and sent its two events. */
let seeded = false

function assertTestBot(): void {
  if (!E2E_BOT.test(BOT)) throw new Error(`refusing to change ${BOT}: not a test bot`)
}

async function routinesOf(page: Page): Promise<RoutineRow[]> {
  const list = await crewApi(page, 'GET', `/crew/routines?bot=${BOT}`)
  expect(list.status, JSON.stringify(list.body)).toBe(200)
  return list.body as RoutineRow[]
}

async function triggersOf(page: Page): Promise<TriggerRow[]> {
  const list = await crewApi(page, 'GET', `/crew/bots/${BOT}/triggers`)
  expect(list.status).toBe(200)
  return (list.body?.triggers ?? []) as TriggerRow[]
}

/** The trigger-only routine the Add trigger and Events screens open; made once. */
async function seedRoutine(page: Page): Promise<string> {
  assertTestBot()
  const have = (await routinesOf(page)).find(r => r.title === ON_EVENT)
  if (have) return have.id
  const made = await crewApi(page, 'POST', `/crew/routines?bot=${BOT}`, {
    title: ON_EVENT, instruction: 'Reply with one word: ok', schedule: { kind: 'daily', time: '09:00' }, timezone: 'UTC', deliverToChat: false, runs: 'triggered'
  })
  expect(made.status, 'trigger-only routine').toBe(201)
  return (made.body as RoutineRow).id
}

/**
 * A trigger with two events that never start a run: one with a wrong signature and one the filter refuses.
 * The one-time secret signs the second request and is then dropped; only statuses are read from the answers.
 */
async function seedEvents(page: Page): Promise<void> {
  const routineId = await seedRoutine(page)
  if (seeded) return
  for (const t of await triggersOf(page)) await crewApi(page, 'DELETE', `/crew/triggers/${t.id}`)
  const made = await crewApi(page, 'POST', `/crew/bots/${BOT}/triggers`, { routineId, name: TRIGGER, source: 'github', events: ['issues'], actions: ['opened'] })
  expect(made.status, 'trigger').toBe(201)
  const { url, secret } = made.body as { url: string; secret: string }
  const id = url.slice(-32)
  const body = JSON.stringify({ action: 'opened', issue: { number: 1, title: 'E2E issue' }, repository: { full_name: 'example/e2e' } })
  expect((await postHook(url, body, githubHeaders(body, 'wrong-secret', 'issues', `bad-${RUN}`))).status, 'wrong signature').toBe(401)
  const push = await postHook(url, body, githubHeaders(body, secret, 'push', `push-${RUN}`))
  expect(push.status, 'refused by the filter').toBe(200)
  await expect.poll(async () => {
    const events = ((await crewApi(page, 'GET', `/crew/triggers/${id}/events`)).body?.events ?? []) as EventRow[]
    return ['bad_signature', 'ignored'].every(outcome => events.some(e => e.outcome === outcome))
  }, { timeout: 90_000, intervals: [2000] }).toBe(true)
  seeded = true
}

async function unseed(page: Page): Promise<void> {
  assertTestBot()
  for (const t of await triggersOf(page)) await crewApi(page, 'DELETE', `/crew/triggers/${t.id}`)
  for (const r of await routinesOf(page)) await crewApi(page, 'DELETE', `/crew/routines/${r.id}?bot=${BOT}`)
}

const rail = (page: Page) => page.getByRole('complementary')
const sidePanel = (page: Page) => page.getByRole('region', { name: 'Panel' })
const rowOf = (page: Page, title: string) => sidePanel(page).getByRole('listitem').filter({ hasText: title }).first()

async function openChat(page: Page, query = ''): Promise<void> {
  await page.goto(`${CREW}/bots/${BOT}${query}`)
  await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
}

/** Apps, once its list (or the reason there is none) has loaded. Every listed app must carry the mask's mark. */
async function openApps(page: Page): Promise<void> {
  await openChat(page)
  await rail(page).getByRole('button', { name: 'Apps', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Apps' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Loading apps…')).toHaveCount(0)
  const loaded = dialog.getByRole('button', { name: 'Connect an app' }).or(dialog.getByRole('button', { name: 'Set the key in Settings' })).or(dialog.getByRole('alert'))
  await expect(loaded.first()).toBeVisible()
  expect(await dialog.locator('li:not([data-app])').count(), 'app rows without the mask mark').toBe(0)
}

/** Settings with the key state read. The key field stays empty: nothing is ever typed into it. */
async function openSettings(page: Page): Promise<void> {
  await openChat(page)
  await rail(page).getByRole('button', { name: 'Settings', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Settings' })
  await expect(dialog.getByRole('combobox', { name: 'Bots working at the same time' })).toBeVisible()
  const keyRow = dialog.locator('[data-private="composio-key"]')
  await expect(keyRow).toHaveCount(1)
  await expect(keyRow.getByText(/^(Saved|Not set)$/)).toBeVisible()
  await expect(keyRow.getByLabel('Composio API key')).toHaveValue('')
  await expect(keyRow.getByLabel('Composio API key')).toHaveAttribute('type', 'password')
  await expect(dialog.locator('[data-private="credit"]')).toHaveCount(1)
}

/** Delete bot on the test bot, open and never confirmed: the handle field stays empty and Delete stays off. */
async function openDelete(page: Page): Promise<void> {
  assertTestBot()
  await openChat(page, '?panel=profile&tab=advanced')
  await page.getByRole('button', { name: 'Delete bot', exact: true }).click()
  const dialog = page.getByRole('alertdialog', { name: `Delete ${BOT_TITLE}?` })
  await expect(dialog.getByLabel(`Type ${BOT} to confirm`)).toHaveValue('')
  await expect(dialog.getByRole('button', { name: 'Delete', exact: true })).toBeDisabled()
}

async function openRoutines(page: Page): Promise<void> {
  await openChat(page, '?panel=routines')
  await expect(page.getByRole('tab', { name: 'Routines' })).toHaveAttribute('aria-selected', 'true')
  await expect(sidePanel(page).getByRole('button', { name: 'New routine', exact: true })).toBeVisible()
}

/** The routine form in the side panel, on a schedule, with its next runs shown. Nothing is saved. */
async function openRoutineForm(page: Page): Promise<void> {
  await openRoutines(page)
  await sidePanel(page).getByRole('button', { name: 'New routine', exact: true }).click()
  await expect(sidePanel(page).getByLabel('Title')).toBeVisible()
  await expect(sidePanel(page).getByRole('radio', { name: 'On a schedule' })).toBeChecked()
  await expect(sidePanel(page).getByRole('combobox', { name: 'When' })).toBeVisible()
  await expect(sidePanel(page).getByText('Next runs')).toBeVisible()
}

async function openTriggers(page: Page): Promise<void> {
  await openRoutines(page)
  const row = rowOf(page, ON_EVENT)
  await expandRoutine(row)
  const toggle = row.getByRole('button', { name: /^Triggers \(/ })
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
}

/** Add trigger, with GitHub picked and one event checked. Create is never pressed. */
async function openAddTrigger(page: Page): Promise<void> {
  await openTriggers(page)
  await rowOf(page, ON_EVENT).getByRole('button', { name: 'Add trigger', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add trigger' })
  await expect(dialog.getByRole('radio', { name: 'GitHub' })).toBeChecked()
  await dialog.getByRole('checkbox', { name: 'issues', exact: true }).click()
  await expect(dialog.getByRole('checkbox', { name: 'issues', exact: true })).toBeChecked()
  await expect(dialog.getByRole('button', { name: 'Create', exact: true })).toBeDisabled()
}

/** A trigger's events, with a failed outcome and a quiet one: the pills PF31 asks to check in both themes. */
async function openEvents(page: Page): Promise<void> {
  await openTriggers(page)
  await page.getByRole('button', { name: `${TRIGGER} actions` }).click()
  await page.getByRole('menuitem', { name: 'Show events' }).click()
  const dialog = page.getByRole('dialog', { name: `Events · ${TRIGGER}` })
  await expect(dialog.getByText('Bad signature', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Ignored by the filter', { exact: true })).toBeVisible()
}

const SCREENS: readonly Screen[] = [
  { id: 'apps-dialog', open: openApps },
  { id: 'settings-dialog', open: openSettings },
  { id: 'delete-bot', open: openDelete },
  { id: 'routine-form', open: openRoutineForm },
  { id: 'add-trigger', setup: async page => { await seedRoutine(page) }, open: openAddTrigger },
  { id: 'trigger-events', setup: seedEvents, open: openEvents }
]

/** A context that has never signed in. */
const signedOut = (browser: Browser) => browser.newContext({ storageState: { cookies: [], origins: [] } })

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  assertTestBot()
  const context = await browser.newContext()
  try {
    const made = await crewApi(await context.newPage(), 'POST', '/crew/bots', { name: BOT, title: BOT_TITLE, avatar: { type: 'circle' } })
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300)
  } finally {
    await context.close()
  }
})

test.afterAll(async ({ browser }) => {
  assertTestBot()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await unseed(page)
    const gone = await crewApi(page, 'DELETE', `/crew/bots/${BOT}`)
    expect(gone.status, JSON.stringify(gone.body)).toBeLessThan(300)
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
        await screen.setup?.(page)
        await screen.open(page)
        await shoot(ctx, shotName(TASK, screen.id))
        expect(seen.errors()).toEqual([])
        expect(await seen.csp()).toEqual([])
      })
    }
  }
}

for (const theme of THEMES) {
  for (const size of sizes()) {
    test(`@task${TASK} login ${theme} ${sizeLabel(size)}`, async ({ browser }) => {
      const context = await signedOut(browser)
      try {
        const page = await context.newPage()
        const ctx: Ctx = { page, theme, size }
        const seen = await watch(page)
        await prepare(ctx)
        // No ticket in the link, so the page asks for one and signs nobody in.
        await page.goto(`${CREW}/login`)
        await expect(page.getByRole('heading', { name: 'Crew' })).toBeVisible()
        await expect(page.getByText('Sign in', { exact: true })).toBeVisible()
        await expect(page.locator('#msg')).toHaveText('Open the link printed by crew login in the VM.')
        await shootLogin(ctx, shotName(TASK, 'login'))
        expect(seen.errors()).toEqual([])
        expect(await seen.csp()).toEqual([])
      } finally {
        await context.close()
      }
    })
  }
}
