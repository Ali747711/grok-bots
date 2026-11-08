import { type Browser, type Page, expect, test } from '@playwright/test'

import { CREW, crewState, deleteTestBots, webappLoginUrl } from './helpers.js'
import { hermesRest, pinFromOtherUi, profileRow, profileRows } from './hermes-rpc.js'

test.describe.configure({ mode: 'serial' })

// Test-owned bots: handle e2e<6 digits>. Everything below writes to these (and nothing else in Hermes).
const run = String(Math.floor(100000 + Math.random() * 800000))
const handle = `e2e${run}`
const title = `E2E Scout ${run}`
const handle2 = `e2e${Number(run) + 1}`
const ROUTINE_MARK = `ROUTINE-${run}`

const NAMESPACE = 'hermes-bots'
const metaOf = async (name: string) => (await profileRow(name))?.ui_meta?.[NAMESPACE]
const cronJobs = async (bot: string) => {
  const res = await hermesRest('GET', `/api/cron/jobs?profile=${encodeURIComponent(bot)}`)
  return res.status === 200 && Array.isArray(res.body) ? (res.body as { name?: string; deliver?: string }[]) : []
}
const cronAll = async () => {
  const res = await hermesRest('GET', '/api/cron/jobs?profile=all')
  expect(res.status, 'cron list across all profiles').toBe(200)
  return (res.body as { name?: string }[]).map(j => j.name ?? '')
}
const soulOf = async (bot: string) => ((await hermesRest('GET', `/api/profiles/${bot}/soul`)).body as { content: string }).content

/** A real 8x8 PNG (valid for the browser's image decoder). */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGP4z9CAFTEMLQkAibNfwVYq284AAAAASUVORK5CYII=', 'base64')
const GIF_DATA_URL = 'data:image/png;base64,R0lGODlhAQABAAAAACw='

test.beforeAll(async () => {
  await deleteTestBots()
})
test.afterAll(async () => {
  await deleteTestBots()
})

async function createBotInDialog(page: Page, name: string, botHandle: string, job: string): Promise<void> {
  await page.goto(CREW)
  await page.getByRole('button', { name: '+ New bot' }).click()
  await page.getByLabel('Name', { exact: true }).fill(name)
  await page.getByRole('button', { name: 'Change handle' }).click()
  await page.getByLabel('Handle').fill(botHandle)
  await page.getByLabel('Job & personality').fill(job)
}

async function webappBots(browser: Browser): Promise<Page> {
  const ctx = await browser.newContext({ storageState: undefined })
  const page = await ctx.newPage()
  await page.goto(webappLoginUrl())
  await page.getByRole('tab', { name: 'Bots' }).click()
  return page
}

test('a bot created in Crew appears identically in the official Webapp', async ({ page, browser }) => {
  await createBotInDialog(page, title, handle, 'Find papers')
  await page.getByRole('button', { name: 'square', exact: true }).click()
  await page.getByRole('button', { name: 'Violet' }).click()
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(new RegExp(`/bots/${handle}$`), { timeout: 120_000 })
  await expect(page.getByRole('complementary').getByText(title, { exact: true })).toBeVisible()

  const webapp = await webappBots(browser)
  await expect(webapp.getByRole('button', { name: new RegExp(`^${title} · @${handle}`) })).toBeVisible({ timeout: 30_000 })
  await webapp.context().close()

  const row = await profileRow(handle)
  expect(row).toBeDefined()
  expect(row?.ui_meta?.[NAMESPACE]).toMatchObject({
    title, crewAvatar: { type: 'square', color: '#7c5cff' }, shape: 'squircle', color: '#7c5cff', custom: true, imageKind: 'shape'
  })
  expect(typeof row?.ui_meta?.[NAMESPACE]?.created).toBe('number')
  // The description is the job text itself; the persona has a title header and no Role line.
  expect(row?.description).toBe('Find papers')
  const soul = await soulOf(handle)
  expect(soul.startsWith(`# ${title}\n`)).toBe(true)
  expect(soul).toContain('**Mission:** Find papers')
  expect(soul).not.toContain('**Role:**')
  expect(row?.canonical_session?.title).toBe('Bot Chat')
})

test('concurrent edits keep both changes', async ({ page }) => {
  await page.goto(`${CREW}/bots/${handle}?panel=profile`)
  const name = page.getByLabel('Name', { exact: true })
  await expect(name).toHaveValue(title)
  await expect(page.getByLabel('Persona (SOUL.md)')).not.toHaveValue('')

  // The other UI pins the bot (whole-object compare-and-swap write, as the Webapp does).
  await pinFromOtherUi(handle)
  // Crew then saves a new name: its read-modify-write must keep `pinned`.
  const renamed = `${title} B`
  await name.fill(renamed)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect.poll(async () => (await metaOf(handle))?.title, { timeout: 30_000 }).toBe(renamed)
  expect(await metaOf(handle)).toMatchObject({ title: renamed, pinned: true })

  // Another app rewrites the persona; Crew's stale baseline must produce a conflict, not an overwrite.
  const theirs = `Their persona ${run}`
  expect((await hermesRest('PUT', `/api/profiles/${handle}/soul`, { content: theirs })).status).toBeLessThan(300)
  await page.getByText('Advanced').click()
  const ours = `Our persona ${run}`
  await page.getByLabel('Persona (SOUL.md)').fill(ours)
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText(/Changed in another app: Persona/)).toBeVisible({ timeout: 30_000 })
  expect(await soulOf(handle)).toBe(theirs)
  await page.getByRole('button', { name: 'Save anyway' }).click()
  await expect.poll(() => soulOf(handle), { timeout: 30_000 }).toBe(ours)
})

test('a failed creation step can be finished', async ({ page }) => {
  await createBotInDialog(page, `E2E Pic ${run}`, handle2, 'Has a photo')
  await page.getByLabel('Upload photo').setInputFiles({ name: 'pic.png', mimeType: 'image/png', buffer: PNG })
  await expect(page.getByRole('img', { name: 'Photo preview' })).toBeVisible()

  // Make only the first create carry an image Hermes refuses (GIF bytes, error 4070).
  let rewritten = false
  await page.route('**/crew/bots', async route => {
    const request = route.request()
    if (request.method() !== 'POST' || rewritten) return route.continue()
    rewritten = true
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>
    await route.continue({ postData: JSON.stringify({ ...body, image: GIF_DATA_URL }) })
  })
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByText(new RegExp(`Created @${handle2}, but avatar failed`))).toBeVisible({ timeout: 120_000 })
  expect((await profileRow(handle2))?.has_avatar).toBeFalsy()

  await page.getByRole('button', { name: 'Finish setup' }).click()
  await expect(page).toHaveURL(new RegExp(`/bots/${handle2}$`), { timeout: 120_000 })
  await expect.poll(async () => (await profileRow(handle2))?.has_avatar, { timeout: 30_000 }).toBe(true)
})

const routineRow = (page: Page, routineTitle: string) => page.getByRole('listitem').filter({ hasText: routineTitle })

async function addRoutine(page: Page, routineTitle: string, instruction: string): Promise<void> {
  await page.getByRole('button', { name: 'New routine' }).click()
  await page.getByLabel('Title').fill(routineTitle)
  await page.getByLabel('What should it do?').fill(instruction)
}

test('a routine runs on schedule and via Run now, shows in history and in Hermes cron list', async ({ page }) => {
  await page.goto(`${CREW}/bots/${handle}?panel=routines`)
  const pingTitle = `Ping ${run}`

  // One-shot after 1 minute, results kept in run history only.
  await addRoutine(page, pingTitle, `Reply with exactly: ${ROUTINE_MARK}`)
  await page.getByRole('combobox', { name: 'When' }).click()
  await page.getByRole('option', { name: 'Once, after…' }).click()
  await page.getByLabel('Amount').fill('1')
  await page.getByRole('combobox', { name: 'Unit' }).click()
  await page.getByRole('option', { name: 'minutes' }).click()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(routineRow(page, pingTitle)).toBeVisible({ timeout: 60_000 })

  // Check Hermes right away: a one-shot may be removed once it has run.
  const jobs = await cronJobs(handle)
  const job = jobs.find(j => j.name === `[bot:${handle}] ${pingTitle}`)
  expect(job, 'cron job in the bot\'s own store').toBeDefined()
  expect(job?.deliver).toBe('local')

  // A completed run appears within 180 s, and the bot's reply (not just the instruction) holds the marker.
  const ping = routineRow(page, pingTitle)
  await ping.getByRole('button', { name: 'History' }).click()
  // A finished one-time routine also reads "Done" in its row, so look inside the run history list.
  await expect(ping.locator('ul').getByText('Done')).toBeVisible({ timeout: 180_000 })
  await ping.getByRole('button', { name: /Ping/ }).first().click()
  const transcript = ping.getByTestId('transcript')
  await expect(transcript).toContainText(`Instruction: Reply with exactly: ${ROUTINE_MARK}`)
  await expect.poll(async () => ((await transcript.textContent()) ?? '').split(ROUTINE_MARK).length - 1, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)

  // A daily routine started with Run now.
  const dailyTitle = `Daily ${run}`
  await addRoutine(page, dailyTitle, `Reply with exactly: ${ROUTINE_MARK}-NOW`)
  await page.getByRole('button', { name: 'Save' }).click()
  const daily = routineRow(page, dailyTitle)
  await expect(daily).toBeVisible({ timeout: 60_000 })
  await daily.getByRole('button', { name: 'History' }).click()
  await daily.getByRole('button', { name: 'Run now' }).click()
  await expect(daily.locator('ul').getByText('Done')).toBeVisible({ timeout: 120_000 })
  expect((await cronJobs(handle)).some(j => j.name === `[bot:${handle}] ${dailyTitle}`)).toBe(true)
})

test('deleting the bot removes it everywhere', async ({ page }) => {
  // Sanity first: the all-profiles list does show this bot's routines, so the check after delete can fail.
  expect((await cronAll()).some(n => n.startsWith(`[bot:${handle}]`))).toBe(true)
  await page.goto(`${CREW}/bots/${handle}?panel=profile`)
  await page.getByRole('button', { name: 'Delete bot' }).click()
  await page.getByLabel(`Type ${handle} to confirm`).fill(handle)
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page).toHaveURL(/\/bots\/default$/, { timeout: 60_000 })
  await expect.poll(async () => (await crewState(page)).bots.some(b => b.name === handle), { timeout: 30_000 }).toBe(false)
  expect((await profileRows()).some(p => p.name === handle)).toBe(false)
  expect((await cronAll()).filter(n => n.startsWith(`[bot:${handle}]`))).toEqual([])
  // The bot's own store is gone too: Hermes answers 404 for the profile (or, at most, an empty list).
  const own = await hermesRest('GET', `/api/cron/jobs?profile=${handle}`)
  expect(own.status === 404 || (own.status === 200 && Array.isArray(own.body) && own.body.length === 0)).toBe(true)
})

async function liveLimit(page: Page): Promise<number | null> {
  const res = await page.request.get(`${CREW}/crew/settings`)
  expect(res.status()).toBe(200)
  return ((await res.json()) as { maxWorkingBots: number | null }).maxWorkingBots
}

/** Last resort: put the live limit back through the API, with the CSRF header the browser would send. */
async function forceLimit(page: Page, value: number | null): Promise<void> {
  const csrf = (await page.context().cookies(CREW)).find(c => c.name === 'crew_csrf')?.value ?? ''
  // Crew's origin guard refuses a state-changing request without an Origin header; page.request sends none.
  const res = await page.request.put(`${CREW}/crew/settings`, { data: { maxWorkingBots: value }, headers: { 'X-Crew-CSRF': csrf, Origin: CREW } })
  expect(res.status(), 'API restore of the working-bot limit').toBe(200)
}

test('the API restore path really writes the working-bot limit', async ({ page }) => {
  await page.goto(CREW)
  const original = await liveLimit(page)
  try {
    await forceLimit(page, 3)
    expect(await liveLimit(page)).toBe(3)
  } finally {
    await forceLimit(page, original)
  }
  expect(await liveLimit(page)).toBe(original)
})

test('the working-bot limit setting persists', async ({ page }) => {
  await page.goto(CREW)
  const dialog = page.getByRole('dialog')
  const openSettings = async () => {
    await page.getByRole('button', { name: 'Settings' }).click()
    return page.getByRole('combobox', { name: 'Bots working at the same time' })
  }
  // The select shows the option text: the number, or "No limit" for the stored value 'none'.
  const optionText = (value: string) => (value === 'none' ? 'No limit' : value)
  // The trigger's own text is the option text plus the chevron glyph Base UI adds; anchor so "1" never matches "12".
  const shows = (value: string) => new RegExp(`^${optionText(value)}\\s*▼?$`)
  // Save and wait for the dialog to close (it closes only after the PUT succeeded) before anything reloads the page.
  const saveLimit = async (value: string) => {
    const select = await openSettings()
    await select.click()
    await page.getByRole('option', { name: optionText(value), exact: true }).click()
    await page.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })
  }
  // Whatever the live limit is now (2 by default) is put back at the end.
  const original = await liveLimit(page)
  try {
    await saveLimit('none')
    await page.reload()
    await expect(await openSettings()).toHaveText(shows('none'))
    expect(await liveLimit(page)).toBeNull()
  } finally {
    try {
      await page.reload()
      if (await dialog.isVisible()) await page.keyboard.press('Escape')
      await saveLimit(original === null ? 'none' : String(original))
    } catch {
      // The UI restore failed; the API restore below makes sure the live value is put back.
    }
    if ((await liveLimit(page)) !== original) await forceLimit(page, original)
  }
  expect(await liveLimit(page)).toBe(original)
  await page.reload()
  await expect(await openSettings()).toHaveText(shows(original === null ? 'none' : String(original)))
})
