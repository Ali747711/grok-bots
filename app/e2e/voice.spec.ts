import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { type Page, expect, test } from '@playwright/test'

import { CREW, crewApi, deleteTestBots, rawConfigOf } from './helpers.js'
import { hermesRest } from './hermes-rpc.js'

// No model turns: e2e bots get no first run unless a create asks for one.
test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const A = `e2e${stamp}1`
const B = `e2e${stamp}2`
const HOUSE = '<!-- crew:house v1 -->'
const PLATFORM_HINT_START = "You're chatting with your owner in a chat app."
let page: Page

const soulOf = async (bot: string): Promise<string> => ((await hermesRest('GET', `/api/profiles/${bot}/soul`)).body as { content: string }).content
const ownerPart = (soul: string): string => {
  const at = soul.indexOf(`\n\n${HOUSE.slice(0, -5)}`)
  return at === -1 ? soul : soul.slice(0, at)
}
const promptOf = async (bot: string): Promise<string> => String(((await rawConfigOf(bot)).agent ?? {}).system_prompt ?? '')
const persona = (p: Page) => p.getByLabel('Persona (SOUL.md)')

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ storageState: '.auth/crew.json' })).newPage()
  await page.goto(CREW)
  for (const [name, title] of [[A, 'Voice A'], [B, 'Voice B']] as const) {
    const made = await crewApi(page, 'POST', '/crew/bots', { name, title, mission: `Job of ${title}`, avatar: { type: 'circle' } })
    expect(made.status).toBe(201)
  }
})

test.afterAll(async () => {
  await page?.context().close()
  await deleteTestBots()
})

test('the Soul tab shows only the owner text and a save keeps one house block', async () => {
  await page.goto(`${CREW}/bots/${A}?panel=profile&tab=soul`)
  await expect(persona(page)).not.toHaveValue('')
  expect(await persona(page).inputValue()).not.toContain('<!--')
  await persona(page).fill('You talk like a ship captain.')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect.poll(async () => ownerPart(await soulOf(A)), { timeout: 30_000 }).toBe('You talk like a ship captain.')
  const soul = await soulOf(A)
  expect(soul.split(HOUSE).length - 1).toBe(1)
  await page.reload()
  await expect(persona(page)).toHaveValue('You talk like a ship captain.')
})

test('a starter adds to the owner text only', async () => {
  await page.goto(`${CREW}/bots/${A}?panel=profile&tab=soul`)
  await expect(persona(page)).toHaveValue('You talk like a ship captain.')
  await page.getByRole('button', { name: 'Careful', exact: true }).click()
  const value = await persona(page).inputValue()
  expect(value.startsWith('You talk like a ship captain.\n\nYou are Voice A.')).toBe(true)
  expect(value).not.toContain('<!--')
})

test('Settings saves your name and the browser time zone, then restores them', async () => {
  const before = (await crewApi(page, 'GET', '/crew/settings')).body as { ownerName?: string | null; timeZone?: string | null }
  try {
    await page.goto(CREW)
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    await page.getByRole('textbox', { name: 'Your name' }).fill('E2E Owner')
    await page.getByRole('dialog').getByRole('button', { name: 'Save', exact: true }).click()
    await expect.poll(async () => ((await crewApi(page, 'GET', '/crew/settings')).body as { ownerName: string | null }).ownerName).toBe('E2E Owner')
    const zone = ((await crewApi(page, 'GET', '/crew/settings')).body as { timeZone: string | null }).timeZone
    expect(zone ?? before.timeZone).toBeTruthy()
    await expect.poll(() => promptOf(A), { timeout: 30_000 }).toContain('Owner: E2E Owner')
  } finally {
    await crewApi(page, 'PUT', '/crew/settings', { ownerName: before.ownerName ?? null, timeZone: before.timeZone ?? null })
  }
})

test('a new e2e bot gets its own Right-now block, voice settings and empty memory', async () => {
  const prompt = await promptOf(B)
  const you = prompt.split('\n').find(l => l.startsWith('You: ')) ?? ''
  expect(you).toContain(`Voice B (@${B})`)
  expect(you).not.toContain('(@hermes)')
  const raw = await rawConfigOf(B)
  expect(String(((raw.platform_hints as Record<string, Record<string, unknown>> | undefined)?.cli ?? {}).replace ?? '').startsWith(PLATFORM_HINT_START)).toBe(true)
  expect((raw.display ?? {}).memory_notifications).toBe('off')
  const mem = (await hermesRest('GET', `/api/memory?profile=${B}`)).body as { builtin_files?: Record<string, number> }
  const sizes = Object.values(mem.builtin_files ?? {})
  expect(sizes.length).toBeGreaterThan(0)
  expect(sizes.every(n => n === 0)).toBe(true)
})

test("a teammate rename reaches the other bot's block", async () => {
  const renamed = `Voice B Renamed ${stamp}`
  expect((await crewApi(page, 'PATCH', `/crew/bots/${B}`, { title: renamed })).status).toBe(200)
  await expect.poll(() => promptOf(A), { timeout: 20_000 }).toContain(`${renamed} (@${B})`)
})

test('@restart migration rewrites an e2e bot with the old template and backs it up', async () => {
  test.setTimeout(180_000)
  const old = `# Voice A\n\n**Mission:** Job of Voice A\n\nYou are Voice A, a persistent named agent (profile \`${A}\`) on this machine.\nYou keep your own memory, skills, and conversation history across sessions.\n\nAlways cite sources.`
  expect((await hermesRest('PUT', `/api/profiles/${A}/soul`, { content: old })).status).toBeLessThan(300)
  execFileSync('systemctl', ['--user', 'restart', 'crew'])
  await expect.poll(async () => {
    const owner = ownerPart(await soulOf(A))
    return owner.includes('Always cite sources.') && !owner.includes('persistent named agent')
  }, { timeout: 120_000, intervals: [3000] }).toBe(true)
  const names = readdirSync(join(homedir(), '.config/crew/soul-backups')).filter(n => n.startsWith(`${A}-`))
  expect(names.length).toBeGreaterThanOrEqual(1)
})
