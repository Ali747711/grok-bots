import { type Page, expect, test } from '@playwright/test'

import { CREW, appsOff, crewApi } from './helpers.js'
import { type Ctx, THEMES, prepare, shoot, shotName, sizeLabel, sizes, watch } from './visual.js'

// The second half of the bot profile's screens of the UI 2 visual check (the harness is in visual.ts; the
// first half is visual-profile.spec.ts, which is at its size limit): the Avatar tab with accessories, the
// Skills tab over Hermes's toolsets and the Apps tab, with the browser checks of what they write.
// Run with `UI2_SIZES=1440x900,1100x800 npx playwright test visual-profile-2.spec.ts --grep @task14` on
// the deployed service.
// NO MODEL CALLS, and every write goes to this spec's own `e2e<digits>` bot, which it deletes at the end.
// The primary bot's Skills tab is opened read-only and is never shot: the harness refuses any page that
// is not a test bot's, because the screenshots are committed.

const TASK = 14
const E2E_BOT = /^e2e\d+$/
const RUN = String(Math.floor(100000 + Math.random() * 800000))
const BOT = `e2e${RUN}`
const BOT_TITLE = `E2E Skills ${RUN}`
const PRIMARY = 'default'
const WORN = { type: 'cat', color: '#ff6fae', hat: 'crown', glasses: 'round', bowTie: true }
const LOCK = `Off while ${BOT_TITLE} runs in a sandbox`
const TERMINAL_WARNING = 'Most work needs this, including approvals and many routines.'

type Tab = 'avatar' | 'skills' | 'apps'
const TAB_LABEL: Readonly<Record<Tab, string>> = { avatar: 'Avatar', skills: 'Skills', apps: 'Apps' }

interface Screen {
  id: string
  open(page: Page): Promise<void>
}

interface Toolset { name: string; enabled: boolean; locked?: string }
interface ConnectedApp { toolkit: string; name: string; status: string }

/** A connected app, turned on for this bot at Read only before the shots; undefined when Crew has none. */
let app: ConnectedApp | undefined
interface Detail { avatar: Record<string, unknown> | null }

function assertTestBot(): void {
  if (!E2E_BOT.test(BOT)) throw new Error(`refusing to change ${BOT}: not a test bot`)
}

async function read<T>(page: Page, path: string): Promise<T> {
  const got = await crewApi(page, 'GET', `/crew/bots/${BOT}${path}`)
  expect(got.status, JSON.stringify(got.body)).toBe(200)
  return got.body as T
}
const toolsetOf = async (page: Page, name: string) => (await read<Toolset[]>(page, '/toolsets')).find(t => t.name === name)?.enabled
const avatarOf = async (page: Page) => (await read<Detail>(page, '')).avatar

const main = (page: Page) => page.getByRole('main')
const tabPanel = (page: Page) => main(page).getByRole('tabpanel')
const skill = (page: Page, label: string) => tabPanel(page).getByRole('switch', { name: label, exact: true })
const skillRow = (page: Page, label: string) => tabPanel(page).getByRole('listitem').filter({ has: page.getByRole('switch', { name: label, exact: true }) })
const chips = (page: Page, group: string) => tabPanel(page).getByRole('radiogroup', { name: group, exact: true })
const chip = (page: Page, group: string, label: string) => chips(page, group).getByRole('radio', { name: label, exact: true })
/** The inputs are visually hidden: a choice is made by clicking its label, as a person does. */
const pickChip = (page: Page, group: string, label: string) => chips(page, group).locator('label').filter({ hasText: label }).click()

/** The e2e bot's profile on one tab, loaded. */
async function openTab(page: Page, tab: Tab): Promise<void> {
  assertTestBot()
  await page.goto(`${CREW}/bots/${BOT}?panel=profile&tab=${tab}`)
  await expect(main(page).getByRole('button', { name: 'Back to chat' })).toBeVisible()
  await expect(main(page).getByRole('tab', { name: TAB_LABEL[tab] })).toHaveAttribute('aria-selected', 'true')
  await expect(main(page).getByRole('tab')).toHaveText(['Identity', 'Avatar', 'Soul', 'Skills', 'Apps', 'Advanced'])
}

/** The Avatar tab on a shape avatar that wears a hat, glasses and a bow tie. */
async function openAvatar(page: Page): Promise<void> {
  await openTab(page, 'avatar')
  const panel = tabPanel(page)
  await expect(panel.getByRole('button', { name: 'cat', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByRole('button', { name: 'Pink', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(panel.getByLabel('Upload photo')).toBeAttached()
  await expect(panel.getByRole('heading', { level: 3 })).toHaveText(['Face', 'Hat', 'Glasses', 'Extras'])
  await expect(chip(page, 'Face', 'Eyes')).toBeChecked()
  await expect(chip(page, 'Hat', 'Crown')).toBeChecked()
  await expect(chip(page, 'Glasses', 'Round')).toBeChecked()
  await expect(panel.getByRole('switch', { name: 'Bow tie', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(panel.getByRole('switch', { name: 'Headphones', exact: true })).toHaveAttribute('aria-checked', 'false')
  await expect(panel.getByText('Accessories show on shape avatars.')).toHaveCount(0)
  await page.mouse.move(0, 0)
}

/** The Skills tab with every row read. */
async function openSkills(page: Page): Promise<void> {
  await openTab(page, 'skills')
  const panel = tabPanel(page)
  await expect(panel.getByText(`Applies from ${BOT_TITLE}'s next message.`, { exact: true })).toBeVisible()
  for (const label of ['Web search', 'Browser', 'Terminal', 'Files', 'Scheduling', 'Screen control']) await expect(skill(page, label)).toBeVisible()
  await expect(skill(page, 'Terminal')).toBeEnabled()
  await page.mouse.move(0, 0)
}

/** The Apps tab once the apps list and the bot's own apps are read. */
async function openApps(page: Page): Promise<void> {
  await openTab(page, 'apps')
  const panel = tabPanel(page)
  await expect(panel.getByRole('heading', { level: 3, name: 'Apps', exact: true })).toBeVisible()
  await expect(panel.getByText('Routines can only use read-only app tools.', { exact: true })).toBeVisible()
  await expect(panel.getByRole('combobox')).toHaveCount(0)
  if (app) {
    await expect(panel.getByRole('switch', { name: `Let ${BOT_TITLE} use ${app.name}`, exact: true })).toBeVisible()
    await expect(chips(page, `${app.name} access`).getByRole('radio', { checked: true })).toHaveCount(1)
  }
  await page.mouse.move(0, 0)
}

const SCREENS: readonly Screen[] = [
  { id: 'profile-avatar', open: openAvatar },
  { id: 'profile-skills', open: openSkills },
  { id: 'profile-apps', open: openApps }
]

test.describe.configure({ mode: 'serial' })

test.beforeAll(async ({ browser }) => {
  assertTestBot()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    const made = await crewApi(page, 'POST', '/crew/bots', { name: BOT, title: BOT_TITLE, avatar: WORN })
    expect(made.status, JSON.stringify(made.body)).toBeLessThan(300)
    const list = await crewApi(page, 'GET', '/crew/connectors/apps')
    app = list.status === 200 ? (list.body as { apps: ConnectedApp[] }).apps.find(a => a.status === 'connected') : undefined
    if (app) {
      const on = await crewApi(page, 'PUT', `/crew/bots/${BOT}/apps`, { [app.toolkit]: 'read' })
      expect(on.status, JSON.stringify(on.body)).toBe(200)
    }
  } finally {
    await context.close()
  }
})

test.afterAll(async ({ browser }) => {
  assertTestBot()
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await appsOff(page, BOT)
    const gone = await crewApi(page, 'DELETE', `/crew/bots/${BOT}`)
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

check('accessories save on click with the rest of the avatar and survive a reload', async page => {
  await openAvatar(page)
  await pickChip(page, 'Hat', 'Beanie')
  await expect.poll(() => avatarOf(page)).toEqual({ ...WORN, hat: 'beanie' })
  await expect(chip(page, 'Hat', 'Beanie')).toBeChecked()
  const headphones = tabPanel(page).getByRole('switch', { name: 'Headphones', exact: true })
  await headphones.click()
  await expect.poll(() => avatarOf(page)).toEqual({ ...WORN, hat: 'beanie', headphones: true })
  // A type pick keeps what the avatar wears.
  await tabPanel(page).getByRole('button', { name: 'ghost', exact: true }).click()
  await expect.poll(() => avatarOf(page)).toEqual({ ...WORN, type: 'ghost', hat: 'beanie', headphones: true })

  await page.reload()
  await expect(chip(page, 'Hat', 'Beanie')).toBeChecked()
  await expect(headphones).toHaveAttribute('aria-checked', 'true')
  // Back to the start, for the shots of a later run in this file.
  await tabPanel(page).getByRole('button', { name: 'cat', exact: true }).click()
  await expect.poll(async () => (await avatarOf(page))?.type).toBe('cat')
  await headphones.click()
  await expect.poll(async () => (await avatarOf(page))?.headphones).toBe(false)
  await pickChip(page, 'Hat', 'Crown')
  await expect.poll(async () => (await avatarOf(page))?.hat).toBe('crown')
})

check('a skill switch writes the toolset at once, warns on Terminal and survives a reload', async page => {
  await openSkills(page)
  const speech = skill(page, 'Speech')
  await expect(speech).toHaveAttribute('aria-checked', 'true')
  await speech.click()
  await expect.poll(() => toolsetOf(page, 'tts')).toBe(false)
  await expect(speech).toHaveAttribute('aria-checked', 'false')

  const terminal = skill(page, 'Terminal')
  await expect(skillRow(page, 'Terminal').getByText(TERMINAL_WARNING, { exact: true })).toHaveCount(0)
  await terminal.click()
  await expect.poll(() => toolsetOf(page, 'terminal')).toBe(false)
  await expect(skillRow(page, 'Terminal').getByText(TERMINAL_WARNING, { exact: true })).toBeVisible()

  await openSkills(page)
  await expect(skill(page, 'Speech')).toHaveAttribute('aria-checked', 'false')
  await expect(skill(page, 'Terminal')).toHaveAttribute('aria-checked', 'false')
  await skill(page, 'Terminal').click()
  await expect.poll(() => toolsetOf(page, 'terminal')).toBe(true)
  await skill(page, 'Speech').click()
  await expect.poll(() => toolsetOf(page, 'tts')).toBe(true)
  // This bot is not sandboxed, so nothing is locked.
  await expect(tabPanel(page).getByText(LOCK, { exact: true })).toHaveCount(0)
  await expect(skill(page, 'Browser')).toBeEnabled()
})

check("the primary bot's skills are read-only with the reason (opened, never changed, never shot)", async page => {
  const writes: string[] = []
  page.on('request', request => {
    if (request.method() !== 'GET' && request.url().includes('/toolsets')) writes.push(`${request.method()} ${request.url()}`)
  })
  await page.goto(`${CREW}/bots/${PRIMARY}?panel=profile&tab=skills`)
  const panel = tabPanel(page)
  await expect(panel.getByText(/^New bots copy .+'s settings, so change these in Hermes$/)).toHaveCount(1)
  await expect(panel.getByRole('switch', { name: 'Web search', exact: true })).toBeVisible()
  for (const toggle of await panel.getByRole('switch').all()) await expect(toggle).toBeDisabled()
  expect(writes).toEqual([])
})

check('an app level is a chip in a group named after the app, and applies at once', async page => {
  test.skip(app === undefined, 'no connected app in Crew: the level chips cannot be shown')
  if (app === undefined) return
  const { toolkit, name } = app
  const levelOf = async () => (await read<{ apps: { toolkit: string; level: string }[] }>(page, '/apps')).apps.find(a => a.toolkit === toolkit)?.level
  await openApps(page)
  const group = `${name} access`
  await expect(chip(page, group, 'Read only')).toBeChecked()
  await pickChip(page, group, 'Read and change')
  await expect.poll(levelOf).toBe('change')
  await expect(chip(page, group, 'Read and change')).toBeChecked()
  const toggle = tabPanel(page).getByRole('switch', { name: `Let ${BOT_TITLE} use ${name}`, exact: true })
  await toggle.click()
  await expect.poll(levelOf).toBeUndefined()
  await expect(chips(page, group)).toHaveCount(0)
  await expect(toggle).toHaveAttribute('aria-checked', 'false')
  await toggle.click()
  await expect.poll(levelOf).toBe('read')
  await expect(chip(page, group, 'Read only')).toBeChecked()
})
