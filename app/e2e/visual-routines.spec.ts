import { type Page, expect, test } from '@playwright/test'

import { CREW, crewApi, expandRoutine } from './helpers.js'
import { type Ctx, THEMES, prepare, shoot, shotName, sizeLabel, sizes, watch } from './visual.js'

// The Routines tab's screens of the UI 2 visual check (the harness is in visual.ts; see visual.spec.ts).
// Run with `npx playwright test visual-routines.spec.ts --grep @task12` on the deployed service.
// NO MODEL CALLS: the routines are made through the API, one "Only when triggered" and one on a monthly
// schedule at least two weeks away; nothing here presses Run now or sends an event. All of it lives on
// this spec's own `e2e<digits>` bot and is deleted at the end.

const TASK = 12
const E2E_BOT = /^e2e\d+$/
const RUN = String(Math.floor(100000 + Math.random() * 800000))
const BOT = `e2e${RUN}`
const BOT_TITLE = `E2E Routines ${RUN}`
const DIGEST = `E2E Digest ${RUN}`
const ON_EVENT = `E2E On event ${RUN}`
const TRIGGER = `E2E GitHub ${RUN}`
const DAYS_AHEAD = 14
const MONTH_DAYS = 28

interface Screen {
  id: string
  setup?(page: Page): Promise<void>
  open(page: Page): Promise<void>
}

interface RoutineRow { id: string; title: string }
interface TriggerRow { id: string; name: string }

/** A day of the month that is two weeks from today, so the scheduled routine cannot come due during the run. */
const farDay = (): number => ((new Date().getUTCDate() - 1 + DAYS_AHEAD) % MONTH_DAYS) + 1

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

/** The two routines and the one trigger the screens show; made once, found again by the later themes. */
async function seed(page: Page): Promise<void> {
  assertTestBot()
  const have = await routinesOf(page)
  if (!have.some(r => r.title === DIGEST)) {
    const made = await crewApi(page, 'POST', `/crew/routines?bot=${BOT}`, {
      title: DIGEST, instruction: 'Reply with one word: ok', schedule: { kind: 'monthly', day: farDay(), time: '03:00' }, timezone: 'UTC', deliverToChat: false, runs: 'schedule'
    })
    expect(made.status, 'scheduled routine').toBe(201)
  }
  let onEvent = have.find(r => r.title === ON_EVENT)?.id
  if (!onEvent) {
    const made = await crewApi(page, 'POST', `/crew/routines?bot=${BOT}`, {
      title: ON_EVENT, instruction: 'Reply with one word: ok', schedule: { kind: 'daily', time: '09:00' }, timezone: 'UTC', deliverToChat: false, runs: 'triggered'
    })
    expect(made.status, 'trigger-only routine').toBe(201)
    onEvent = (made.body as RoutineRow).id
  }
  if (!(await triggersOf(page)).some(t => t.name === TRIGGER)) {
    // The answer carries the one-time secret: only its status is read, and it is never printed.
    const made = await crewApi(page, 'POST', `/crew/bots/${BOT}/triggers`, { routineId: onEvent, name: TRIGGER, source: 'github', events: ['issues'], actions: ['opened'] })
    expect(made.status, 'trigger').toBe(201)
  }
}

async function unseed(page: Page): Promise<void> {
  assertTestBot()
  for (const t of await triggersOf(page)) await crewApi(page, 'DELETE', `/crew/triggers/${t.id}`)
  for (const r of await routinesOf(page)) await crewApi(page, 'DELETE', `/crew/routines/${r.id}?bot=${BOT}`)
}

const sidePanel = (page: Page) => page.getByRole('region', { name: 'Panel' })
const rowOf = (page: Page, title: string) => sidePanel(page).getByRole('listitem').filter({ hasText: title }).first()

/** Wait until an open row's height spring has come to rest (a spring `shoot` cannot freeze): motion then leaves the height on auto. */
async function detailsAtRest(page: Page, title: string): Promise<void> {
  const details = rowOf(page, title).getByRole('group', { name: `${title} details` })
  await expect.poll(() => details.evaluate(el => (el as HTMLElement).style.height)).toBe('auto')
}

async function openRoutines(page: Page): Promise<void> {
  await page.goto(`${CREW}/bots/${BOT}?panel=routines`)
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  await expect(page.getByTestId('chat-skeleton')).toHaveCount(0)
  await expect(page.getByRole('tab', { name: 'Routines' })).toHaveAttribute('aria-selected', 'true')
  await expect(sidePanel(page).getByRole('button', { name: 'New routine', exact: true })).toBeVisible()
}

/** No routines yet: the empty copy and New routine. */
async function openEmpty(page: Page): Promise<void> {
  await openRoutines(page)
  await expect(sidePanel(page).getByText(/^No routines yet\./)).toBeVisible()
}

/** Closed rows: name, schedule, next run and Run now in view; the switch, Edit, History and Delete are not. */
async function openList(page: Page): Promise<void> {
  await openRoutines(page)
  const digest = rowOf(page, DIGEST)
  await expect(digest.getByText(/^Next · /)).toBeVisible()
  await expect(digest.getByRole('button', { name: 'Run now', exact: true })).toBeVisible()
  await expect(digest.getByRole('button', { name: 'Routine details' })).toHaveAttribute('aria-expanded', 'false')
  await expect(digest.getByRole('switch')).toHaveCount(0)
  await expect(digest.getByRole('button', { name: 'History', exact: true })).toHaveCount(0)
  const onEvent = rowOf(page, ON_EVENT)
  await expect(onEvent.getByText('Only when triggered', { exact: true })).toBeVisible()
  await expect(onEvent.getByRole('button', { name: 'Run now', exact: true })).toBeVisible()
}

/** The scheduled routine opened: its switch, Edit, History (no runs yet), Delete and Triggers (0). */
async function openScheduled(page: Page): Promise<void> {
  await openRoutines(page)
  const digest = rowOf(page, DIGEST)
  await expandRoutine(digest)
  await expect(digest.getByRole('switch', { name: `${DIGEST} enabled` })).toBeChecked()
  for (const name of ['Edit', 'Delete']) await expect(digest.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(digest.getByRole('button', { name: 'Triggers (0)', exact: true })).toBeVisible()
  await digest.getByRole('button', { name: 'History', exact: true }).click()
  await expect(digest.getByText('No runs yet.', { exact: true })).toBeVisible()
  await detailsAtRest(page, DIGEST)
}

/** The trigger-only routine opened with its trigger listed: no pause switch, only the trigger's own. */
async function openTriggered(page: Page): Promise<void> {
  await openRoutines(page)
  const onEvent = rowOf(page, ON_EVENT)
  await expandRoutine(onEvent)
  await expect(onEvent.getByRole('switch', { name: `${ON_EVENT} enabled` })).toHaveCount(0)
  await onEvent.getByRole('button', { name: 'Triggers (1)', exact: true }).click()
  await expect(onEvent.getByRole('switch', { name: `${TRIGGER} on` })).toBeChecked()
  await expect(onEvent.getByText('No events yet', { exact: true })).toBeVisible()
  await expect(onEvent.getByRole('button', { name: `${TRIGGER} actions` })).toBeVisible()
  await expect(onEvent.getByRole('button', { name: 'Add trigger', exact: true })).toBeVisible()
  await detailsAtRest(page, ON_EVENT)
}

const SCREENS: readonly Screen[] = [
  { id: 'routines-empty', open: openEmpty },
  { id: 'routines', setup: seed, open: openList },
  { id: 'routines-open', setup: seed, open: openScheduled },
  { id: 'routines-triggers', setup: seed, open: openTriggered }
]

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
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
