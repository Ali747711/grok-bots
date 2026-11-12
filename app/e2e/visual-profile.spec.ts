import { type Page, expect, test } from '@playwright/test'

import { CREW, crewApi } from './helpers.js'
import { type Ctx, THEMES, prepare, shoot, shotName, sizeLabel, sizes, watch } from './visual.js'

// The bot profile's screens of the UI 2 visual check (the harness is in visual.ts; see visual.spec.ts),
// and the browser checks of what the profile changes: approvals, the screen's idle stop, the use-screen
// switch, the save bar, Hide and Delete.
// Run with `UI2_SIZES=1440x900,1100x800 npx playwright test visual-profile.spec.ts --grep @task13` on the
// deployed service (the narrow size shows the summary card hidden).
// NO MODEL CALLS, and every write goes to this spec's own `e2e<digits>` bot, which it deletes at the end.
// The primary bot's profile is opened read-only and is never shot: the harness refuses any page that is
// not a test bot's, because the screenshots are committed.

const TASK = 13
const E2E_BOT = /^e2e\d+$/
const RUN = String(Math.floor(100000 + Math.random() * 800000))
const BOT = `e2e${RUN}`
const BOT_TITLE = `E2E Profile ${RUN}`
const JOB = 'Reads the release notes every morning and lists what changed for the team.'
const PRIMARY = 'default'
const CARD_MIN_WIDTH = 820
const CONFIRM_COPY = `Risky commands will run without asking you, and ${BOT_TITLE}'s apps drop to Read only.`
const NEVER_NOTE = "Each running screen holds about 350 MB until it's stopped."

type Tab = 'identity' | 'soul' | 'advanced'

interface Screen {
  id: string
  open(page: Page): Promise<void>
}

interface Approvals { mode: string; isDefault: boolean; sandboxed: boolean }
interface ScreenConfig { useScreen: boolean; idleStopMinutes: number | null }
interface Detail { title: string; description: string; hidden: boolean }

function assertTestBot(): void {
  if (!E2E_BOT.test(BOT)) throw new Error(`refusing to change ${BOT}: not a test bot`)
}

async function read<T>(page: Page, path: string): Promise<T> {
  const got = await crewApi(page, 'GET', `/crew/bots/${BOT}${path}`)
  expect(got.status, JSON.stringify(got.body)).toBe(200)
  return got.body as T
}
const approvalsOf = async (page: Page) => (await read<Approvals>(page, '/approvals')).mode
const screenOf = (page: Page) => read<ScreenConfig>(page, '/screen/config')
const detailOf = (page: Page) => read<Detail>(page, '')

const main = (page: Page) => page.getByRole('main')
const tabPanel = (page: Page) => main(page).getByRole('tabpanel')
const card = (page: Page) => main(page).getByRole('complementary', { name: `${BOT_TITLE} at a glance` })
const mode = (page: Page, label: string) => tabPanel(page).getByRole('radio', { name: new RegExp(`^${label}`) })
const sleep = (page: Page, label: string) => tabPanel(page).getByRole('radiogroup', { name: 'Stop the screen after' }).getByRole('radio', { name: label, exact: true })
/** The inputs are visually hidden: a choice is made by clicking its label, as a person does. */
const pickMode = (page: Page, label: string) => tabPanel(page).getByRole('radiogroup', { name: 'Approvals' }).locator('label').filter({ hasText: label }).click()
const pickSleep = (page: Page, label: string) => tabPanel(page).getByRole('radiogroup', { name: 'Stop the screen after' }).locator('label').filter({ hasText: label }).click()
const saveButton = (page: Page) => main(page).getByRole('button', { name: 'Save', exact: true })

/** The e2e bot's profile on one tab, loaded, with the summary card shown or hidden as the width says. */
async function openTab(page: Page, tab: Tab): Promise<void> {
  assertTestBot()
  await page.goto(`${CREW}/bots/${BOT}?panel=profile${tab === 'identity' ? '' : `&tab=${tab}`}`)
  await expect(main(page).getByRole('button', { name: 'Back to chat' })).toBeVisible()
  const selected = { identity: 'Identity', soul: 'Soul', advanced: 'Advanced' }[tab]
  await expect(main(page).getByRole('tab', { name: selected })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('region', { name: 'Panel' })).toHaveCount(0)
  const width = (await main(page).boundingBox())?.width ?? 0
  if (width >= CARD_MIN_WIDTH) {
    await expect(card(page)).toBeVisible()
    // The card's settings have been read.
    await expect(card(page).getByText(/^\d+ apps? connected$/)).toBeVisible()
  } else {
    await expect(card(page)).toBeHidden()
  }
}

async function openIdentity(page: Page): Promise<void> {
  await openTab(page, 'identity')
  await expect(main(page).getByLabel('Name', { exact: true })).toHaveValue(BOT_TITLE)
  await expect(main(page).getByLabel('Job', { exact: true })).toHaveValue(JOB)
  await expect(tabPanel(page).getByText(`@${BOT}`, { exact: true })).toBeVisible()
  await expect(main(page).getByRole('radiogroup', { name: 'Role' })).toBeVisible()
  await expect(main(page).getByRole('combobox', { name: 'Model' })).toBeVisible()
  await expect(saveButton(page)).toHaveCount(0)
}

async function openSoul(page: Page): Promise<void> {
  await openTab(page, 'soul')
  await expect(main(page).getByLabel('Persona (SOUL.md)')).not.toHaveValue('')
  for (const name of ['Careful', 'Fast', 'Friendly']) await expect(main(page).getByRole('button', { name, exact: true })).toBeVisible()
  await expect(saveButton(page)).toHaveCount(0)
}

/** Advanced with everything read: the mode in effect, the sleep choice and the sandbox state. */
async function openAdvanced(page: Page): Promise<void> {
  await openTab(page, 'advanced')
  const panel = tabPanel(page)
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Approvals', 'Computer', 'Sandbox', 'Hide', 'Danger zone'])
  await expect(panel.getByRole('radiogroup', { name: 'Approvals' }).getByRole('radio', { checked: true })).toHaveCount(1)
  await expect(panel.getByRole('radiogroup', { name: 'Stop the screen after' }).getByRole('radio', { checked: true })).toHaveCount(1)
  await expect(panel.getByRole('switch', { name: `Let ${BOT_TITLE} use its screen` })).toBeEnabled()
  await expect(panel.getByRole('switch', { name: `Run ${BOT_TITLE}'s tools in a sandbox` })).toBeVisible()
  await expect(panel.locator('section').filter({ has: page.getByRole('heading', { name: 'Sandbox', exact: true }) }).getByRole('status')).not.toBeEmpty()
  await expect(panel.getByRole('button', { name: 'Delete bot', exact: true })).toBeVisible()
}

/** A typed name, not saved: the one save bar. Nothing is written. */
async function openSaveBar(page: Page): Promise<void> {
  await openIdentity(page)
  await main(page).getByLabel('Name', { exact: true }).fill(`${BOT_TITLE} draft`)
  await expect(main(page).getByText('Unsaved changes', { exact: true })).toBeVisible()
  await expect(main(page).getByRole('button', { name: 'Discard', exact: true })).toBeVisible()
  await expect(saveButton(page)).toBeEnabled()
  // The pointer is parked so no tooltip or hover state is in the shot.
  await page.mouse.move(0, 0)
}

/** "Never ask" clicked, not confirmed: the inline confirm. Nothing is written. */
async function openConfirm(page: Page): Promise<void> {
  await openAdvanced(page)
  const before = await approvalsOf(page)
  expect(before, 'the screen needs a mode other than off to show the confirm').not.toBe('off')
  await pickMode(page, 'Never ask')
  const confirm = tabPanel(page).getByRole('group', { name: 'Turn off approvals?' })
  await expect(confirm).toContainText(CONFIRM_COPY)
  await expect(confirm.getByRole('button', { name: 'Turn off approvals', exact: true })).toBeVisible()
  expect(await approvalsOf(page)).toBe(before)
  await page.mouse.move(0, 0)
}

const SCREENS: readonly Screen[] = [
  { id: 'profile-identity', open: openIdentity },
  { id: 'profile-soul', open: openSoul },
  { id: 'profile-advanced', open: openAdvanced },
  { id: 'profile-save-bar', open: openSaveBar },
  { id: 'profile-approvals-confirm', open: openConfirm }
]

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  assertTestBot()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const made = await crewApi(page, 'POST', '/crew/bots', { name: BOT, title: BOT_TITLE, mission: JOB, avatar: { type: 'circle' }, role: 'researcher' })
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300)
    // A known start, whatever the primary's config gave the copy: the checker mode, written explicitly.
    const start = await crewApi(page, 'PUT', `/crew/bots/${BOT}/approvals`, { mode: 'smart' })
    expect(start.status, JSON.stringify(start.body)).toBe(200)
  } finally {
    await context.close()
  }
})

test.afterAll(async ({ browser }) => {
  assertTestBot()
  const context = await browser.newContext()
  try {
    // The last check deletes the bot through the dialog; this only cleans up after a failed run.
    const gone = await crewApi(await context.newPage(), 'DELETE', `/crew/bots/${BOT}`)
    expect([204, 404], JSON.stringify(gone.body)).toContain(gone.status)
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
        await screen.open(page)
        await shoot(ctx, shotName(TASK, screen.id))
        expect(seen.errors()).toEqual([])
        expect(await seen.csp()).toEqual([])
      })
    }
  }
}

/** One browser check at 1440×900 in the dark theme, with the same error and CSP watch as the shots. */
function check(name: string, body: (page: Page) => Promise<void>): void {
  test(`@task${TASK} check: ${name}`, async ({ page }) => {
    const seen = await watch(page)
    await prepare({ page, theme: 'dark', size: { width: 1440, height: 900 } })
    await body(page)
    expect(seen.errors()).toEqual([])
    expect(await seen.csp()).toEqual([])
  })
}

check('approvals apply at once, and Never ask asks first', async page => {
  await openAdvanced(page)
  await expect(mode(page, 'Let a checker model decide first')).toBeChecked()
  await pickMode(page, 'Ask before risky commands')
  await expect.poll(() => approvalsOf(page)).toBe('manual')
  await expect(mode(page, 'Ask before risky commands')).toBeChecked()
  await expect(card(page).getByText('Asks first', { exact: true })).toBeVisible()

  // Never ask: nothing is written until the confirm, and Cancel writes nothing.
  await pickMode(page, 'Never ask')
  const confirm = tabPanel(page).getByRole('group', { name: 'Turn off approvals?' })
  await expect(confirm).toContainText(CONFIRM_COPY)
  expect(await approvalsOf(page)).toBe('manual')
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  expect(await approvalsOf(page)).toBe('manual')
  await expect(mode(page, 'Ask before risky commands')).toBeChecked()

  await pickMode(page, 'Never ask')
  await confirm.getByRole('button', { name: 'Turn off approvals', exact: true }).click()
  await expect.poll(() => approvalsOf(page)).toBe('off')
  await expect(mode(page, 'Never ask')).toBeChecked()

  // Survives a reload, then goes back to the checker mode.
  await openAdvanced(page)
  await expect(mode(page, 'Never ask')).toBeChecked()
  await pickMode(page, 'Let a checker model decide first')
  await expect.poll(() => approvalsOf(page)).toBe('smart')
  await expect(tabPanel(page).getByText('Applies from the next risky command.', { exact: true })).toBeVisible()
  await expect(tabPanel(page).getByText('App actions ask through their own prompt. Never ask turns that off too.', { exact: true })).toBeVisible()
})

check('arrow keys never write Never ask: they only open the confirm', async page => {
  await openAdvanced(page)
  await expect(mode(page, 'Let a checker model decide first')).toBeChecked()
  // A real browser moves a radio group's choice with the arrow keys and fires a change on the way.
  await mode(page, 'Let a checker model decide first').focus()
  await page.keyboard.press('ArrowDown')
  const confirm = tabPanel(page).getByRole('group', { name: 'Turn off approvals?' })
  await expect(confirm).toContainText(CONFIRM_COPY)
  expect(await approvalsOf(page)).toBe('smart')
  await expect(mode(page, 'Let a checker model decide first')).toBeChecked()
  await expect(mode(page, 'Never ask')).not.toBeChecked()
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(confirm).toHaveCount(0)
  expect(await approvalsOf(page)).toBe('smart')
})

check('the sleep chips and the use-screen switch write the screen config', async page => {
  await openAdvanced(page)
  await expect(sleep(page, '15 min')).toBeChecked()
  await pickSleep(page, '1 hour')
  await expect.poll(async () => (await screenOf(page)).idleStopMinutes).toBe(60)
  await expect(sleep(page, '1 hour')).toBeChecked()
  await expect(card(page).getByText('1 hour', { exact: true })).toBeVisible()
  await pickSleep(page, 'Never')
  await expect.poll(async () => (await screenOf(page)).idleStopMinutes).toBe(0)
  await expect(tabPanel(page).getByText(NEVER_NOTE, { exact: true })).toBeVisible()
  await pickSleep(page, '15 min')
  await expect.poll(async () => (await screenOf(page)).idleStopMinutes).toBe(15)
  await expect(tabPanel(page).getByText(NEVER_NOTE, { exact: true })).toHaveCount(0)

  const toggle = tabPanel(page).getByRole('switch', { name: `Let ${BOT_TITLE} use its screen` })
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect.poll(async () => (await screenOf(page)).useScreen).toBe(true)
  await expect(toggle).toHaveAttribute('aria-checked', 'true')
  // The sleep choice is not disturbed by the switch.
  expect((await screenOf(page)).idleStopMinutes).toBe(15)
  await toggle.click()
  await expect.poll(async () => (await screenOf(page)).useScreen).toBe(false)
})

check('the save bar keeps edits across leaving, saves with Ctrl+Enter from a field and discards', async page => {
  await openIdentity(page)
  const name = main(page).getByLabel('Name', { exact: true })
  const job = main(page).getByLabel('Job', { exact: true })
  await name.fill(`${BOT_TITLE} draft`)
  await expect(main(page).getByText('Unsaved changes', { exact: true })).toBeVisible()

  // Leave with Back, come back through the header: the edit is still there, and nothing was saved.
  await main(page).getByRole('button', { name: 'Back to chat' }).click()
  await expect(page).toHaveURL(new RegExp(`/bots/${BOT}$`))
  await main(page).getByRole('button', { name: 'Profile', exact: true }).click()
  await expect(name).toHaveValue(`${BOT_TITLE} draft`)
  expect((await detailOf(page)).title).toBe(BOT_TITLE)

  // The bar follows the user to another tab; Discard puts the saved name back.
  await main(page).getByRole('tab', { name: 'Soul' }).click()
  await expect(saveButton(page)).toBeEnabled()
  await main(page).getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(saveButton(page)).toHaveCount(0)
  await main(page).getByRole('tab', { name: 'Identity' }).click()
  await expect(name).toHaveValue(BOT_TITLE)

  const edited = `${JOB} Then it files the list.`
  await job.fill(edited)
  await job.press('Control+Enter')
  await expect.poll(async () => (await detailOf(page)).description).toBe(edited)
  await expect(saveButton(page)).toHaveCount(0)
  await expect(job).toHaveValue(edited)
})

check('the primary bot shows approvals and sleep read-only (opened, never changed, never shot)', async page => {
  await page.goto(`${CREW}/bots/${PRIMARY}?panel=profile&tab=advanced`)
  const panel = tabPanel(page)
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Approvals', 'Computer', 'Sandbox'])
  const approvals = panel.getByRole('radiogroup', { name: 'Approvals' })
  const sleeps = panel.getByRole('radiogroup', { name: 'Stop the screen after' })
  await expect(approvals.getByRole('radio', { checked: true })).toHaveCount(1)
  await expect(sleeps.getByRole('radio', { checked: true })).toHaveCount(1)
  for (const group of [approvals, sleeps]) {
    await expect(group).toHaveAttribute('disabled', '')
    for (const radio of await group.getByRole('radio').all()) await expect(radio).toBeDisabled()
  }
  await expect(panel.getByText(/^New bots copy .+'s settings, so change these in Hermes$/)).toHaveCount(2)
  await expect(panel.getByRole('switch', { name: /use its screen$/ })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Delete bot', exact: true })).toHaveCount(0)
  await expect(panel.getByRole('heading', { name: 'Danger zone' })).toHaveCount(0)
})

check('Hide applies at once, and Delete needs the typed handle', async page => {
  await openAdvanced(page)
  const hide = tabPanel(page).getByRole('switch', { name: 'Hide from the list', exact: true })
  await hide.click()
  await expect.poll(async () => (await detailOf(page)).hidden).toBe(true)
  await expect(hide).toHaveAttribute('aria-checked', 'true')
  await hide.click()
  await expect.poll(async () => (await detailOf(page)).hidden).toBe(false)

  await tabPanel(page).getByRole('button', { name: 'Delete bot', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  const confirm = dialog.getByRole('button', { name: 'Delete', exact: true })
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(`Type ${BOT} to confirm`).fill(BOT.slice(0, -1))
  await expect(confirm).toBeDisabled()
  await dialog.getByLabel(`Type ${BOT} to confirm`).fill(BOT)
  await confirm.click()
  await expect(page).toHaveURL(new RegExp(`/bots/${PRIMARY}$`), { timeout: 60_000 })
  expect((await crewApi(page, 'GET', `/crew/bots/${BOT}`)).status).toBe(404)
})
