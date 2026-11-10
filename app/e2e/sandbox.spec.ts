import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { CREW, cleanupContainers, containersOf, createBotInDialog, crewApi, deleteTestBots, hasSandboxFolder } from './helpers.js'
import { hermesRest, profileRows, withRpc } from './hermes-rpc.js'

// No model calls. Run by the controller against the deployed build; skipped when the sandbox image is absent.
// Only e2e<digits> bots get containers; crew-test's sandbox is read, never changed.

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const A = `e2e${stamp}`
const B = `e2e${stamp + 1}`
const TITLE_A = `E2E Sandbox A ${stamp}`
const TITLE_B = `E2E Sandbox B ${stamp}`
const SPA_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
const RESET_NOTE = "Files in the bot's working folder are kept; anything else resets."

let crewTestBackend: unknown

type Cfg = { terminal?: Record<string, unknown>; agent?: { disabled_toolsets?: string[] } }

async function rawConfig(bot: string): Promise<Cfg> {
  const res = await hermesRest('GET', `/api/config?profile=${encodeURIComponent(bot)}&include_defaults=false`)
  expect(res.status).toBe(200)
  return res.body as Cfg
}

const toolsets = async (bot: string) => (await rawConfig(bot)).agent?.disabled_toolsets
const backend = async (bot: string) => (await rawConfig(bot)).terminal?.backend

const markerOf = async (bot: string) => (await profileRows()).find(p => p.name === bot)?.ui_meta?.['hermes-bots']?.sandbox

const section = (page: Page) => page.locator('section').filter({ has: page.getByRole('heading', { name: 'Sandbox', exact: true }) })
const sandboxSwitch = (page: Page, title: string) => section(page).getByRole('switch', { name: `Run ${title}'s tools in a sandbox` })

async function openProfile(page: Page, bot: string, title: string): Promise<void> {
  await page.goto(`${CREW}/bots/${bot}?panel=profile`)
  await expect(sandboxSwitch(page, title)).toBeVisible()
  // The switch stays disabled until the section has read the state.
  await expect(sandboxSwitch(page, title)).toBeEnabled()
}

async function flip(page: Page, title: string, on: boolean): Promise<void> {
  await sandboxSwitch(page, title).click()
  await expect(page.getByText(on ? 'Sandbox on' : 'Sandbox off').first()).toBeVisible({ timeout: 30_000 })
  if (on) await expect(sandboxSwitch(page, title)).toBeChecked()
  else await expect(sandboxSwitch(page, title)).not.toBeChecked()
}

const startDisplay = (bot: string) => withRpc(rpc => rpc.call('display.start', { profile: bot }))
const stopDisplay = (bot: string) => withRpc(rpc => rpc.call('display.stop', { profile: bot, force: true })).catch(() => undefined)

test.beforeAll(async () => {
  const image = 'nousresearch/hermes-sandbox:desktop'
  let present = true
  try {
    execFileSync('docker', ['image', 'inspect', image], { stdio: 'ignore', timeout: 5000 })
  } catch {
    present = false
  }
  test.skip(!present, 'the sandbox image is not downloaded')
  await deleteTestBots()
  crewTestBackend = await backend('crew-test')
})

test.afterAll(async () => {
  await Promise.all([A, B].map(stopDisplay))
  await deleteTestBots()
})

test('a new bot made with the box ticked runs in a sandbox, with the badge and the Sandbox section', async ({ page }) => {
  await createBotInDialog(page, TITLE_A, A, { sandbox: true })
  const cfg = await rawConfig(A)
  expect(cfg.terminal).toMatchObject({ backend: 'docker', container_memory: 3072, docker_run_as_host_user: true })
  expect(cfg.agent?.disabled_toolsets).toContain('browser')
  expect(await markerOf(A)).toEqual({ on: true, addedBrowserDisable: true })
  await expect(page.locator(`[data-bot="${A}"]`).getByRole('img', { name: 'Sandboxed' })).toBeVisible()
  await expect(page.locator('header').filter({ has: page.getByRole('heading', { name: TITLE_A }) }).getByRole('img', { name: 'Sandboxed' })).toBeVisible()
  await openProfile(page, A, TITLE_A)
  await expect(section(page).getByRole('status')).toHaveText('Sandbox ready')
  await expect(sandboxSwitch(page, TITLE_A)).toBeChecked()
})

test("the user's own disabled toolsets survive switching on and off", async ({ page }) => {
  await page.goto(CREW)
  const made = await crewApi(page, 'POST', '/crew/bots', { name: B, title: TITLE_B, avatar: { type: 'circle' }, sandbox: false })
  expect(made.status).toBeLessThan(300)
  await page.goto(`${CREW}/bots/${B}`)
  await expect(page.locator(`[data-bot="${B}"]`)).toBeVisible()
  await expect(page.locator(`[data-bot="${B}"]`).getByRole('img', { name: 'Sandboxed' })).toHaveCount(0)
  const put = (list: string[]) => hermesRest('PUT', `/api/config?profile=${B}`, { config: { agent: { disabled_toolsets: list } } })
  expect((await put(['tts'])).status).toBe(200)
  await openProfile(page, B, TITLE_B)
  await flip(page, TITLE_B, true)
  expect(await toolsets(B)).toEqual(['tts', 'browser'])
  expect(await markerOf(B)).toMatchObject({ on: true, addedBrowserDisable: true })
  await flip(page, TITLE_B, false)
  expect(await toolsets(B)).toEqual(['tts'])
  expect(await backend(B)).toBe('local')
  // A browser entry the user set by hand is not Crew's to remove.
  expect((await put(['tts', 'browser'])).status).toBe(200)
  await openProfile(page, B, TITLE_B)
  await flip(page, TITLE_B, true)
  expect(await markerOf(B)).toMatchObject({ on: true, addedBrowserDisable: false })
  await flip(page, TITLE_B, false)
  expect(await toolsets(B)).toEqual(['tts', 'browser'])
})

test("Reset sandbox removes only that bot's container", async ({ page }) => {
  await openProfile(page, B, TITLE_B)
  await flip(page, TITLE_B, true)
  await startDisplay(A)
  await startDisplay(B)
  expect(containersOf(A)).toHaveLength(1)
  expect(containersOf(B)).toHaveLength(1)
  await openProfile(page, A, TITLE_A)
  await expect(section(page).getByRole('status')).toHaveText(/^Running · \d+ MB$/, { timeout: 30_000 })
  await section(page).getByRole('button', { name: 'Reset sandbox', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('Reset the sandbox?')
  await expect(dialog).toContainText(RESET_NOTE)
  await dialog.getByRole('button', { name: 'Reset sandbox', exact: true }).click()
  await expect(page.getByText('Sandbox reset').first()).toBeVisible({ timeout: 30_000 })
  expect(containersOf(A)).toHaveLength(0)
  expect(containersOf(B)).toHaveLength(1)
  await expect(section(page).getByRole('status')).toHaveText('Sandbox ready')
})

test('switching off removes the container and keeps the sandbox folder', async ({ page }) => {
  await openProfile(page, B, TITLE_B)
  await flip(page, TITLE_B, false)
  await expect.poll(() => containersOf(B).length, { timeout: 30_000 }).toBe(0)
  expect(await backend(B)).toBe('local')
  expect(hasSandboxFolder(B)).toBe(true)
})

test('deleting a bot removes its sandbox files, container and profile', async ({ page }) => {
  for (const bot of [A, B]) {
    await page.goto(`${CREW}/bots/${bot}?panel=profile`)
    await page.getByRole('button', { name: 'Delete bot', exact: true }).click()
    await page.getByLabel(`Type ${bot} to confirm`).fill(bot)
    await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click()
    await expect(page).toHaveURL(/\/bots\/default$/, { timeout: 60_000 })
  }
  for (const bot of [A, B]) {
    await expect.poll(() => existsSync(join(homedir(), '.hermes', 'profiles', bot)), { timeout: 30_000 }).toBe(false)
  }
  const list = await hermesRest('GET', '/api/profiles')
  const names = ((list.body as { profiles?: { name: string }[] }).profiles ?? []).map(p => p.name)
  expect(names).not.toContain(A)
  expect(names).not.toContain(B)
  expect(containersOf(A)).toEqual([])
  expect(containersOf(B)).toEqual([])
  expect(cleanupContainers()).toEqual([])
})

test('guards: no CSRF is refused, crew-test stays off and local, the CSP is unchanged', async ({ page }) => {
  await page.goto(CREW)
  const refused = await page.request.put(`${CREW}/crew/bots/e2e0/sandbox`, { data: { on: true } })
  expect(refused.status()).toBe(403)
  const read = await crewApi(page, 'GET', '/crew/bots/crew-test/sandbox')
  expect(read.status).toBe(200)
  expect(read.body.state).toBe('off')
  expect(await backend('crew-test')).toEqual(crewTestBackend)
  const root = await page.request.get(`${CREW}/`)
  expect(root.headers()['content-security-policy']).toBe(SPA_CSP)
})
