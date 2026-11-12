import { type Page, expect, test } from '@playwright/test'

import { CREW, crewApi, deleteTestBots, openBot, send, waitIdle } from './helpers.js'
import { hermesRest, profileRows, sessionMessages } from './hermes-rpc.js'

// SPENDS CREDIT: one model turn (with computer use). Controller-only. A sandboxed bot has no browser tool
// (Crew turns it off: its Python runs on the host), so it must browse with the Browser on its own screen.

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const BOT = `e2e${stamp}`
const MATE = `e2e${stamp}7`
const MATE_TITLE = 'Quill'
const ROUTINE = 'Morning digest'
const FRUIT = ['rambutan', 'mangosteen', 'cherimoya', 'jabuticaba'][stamp % 4]!
const MODEL = { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' }
const MIN_CREDIT = 0.2
const REPLY_MS = 180_000
const FORBIDDEN: readonly RegExp[] = [
  /:\d{1,3}\b|display (number )?\d+/i,
  /\bpid\b/i,
  /computer_use|cronjob|session_search|execute_code|read_file|write_file|terminal\(|mcp_|message_agent/,
  /\/home\/|\.hermes|\/workspace/,
  /as an AI/i
]
let page: Page

const sentences = (text: string): number => text.trim().split(/(?<=[.!?])\s+/).filter(s => /\w/.test(s)).length

async function chatRows(bot = BOT): Promise<{ role: string; content: string }[]> {
  const chat = (await profileRows()).find(p => p.name === bot)?.canonical_session as { id?: string; resolved_id?: string } | null | undefined
  const id = chat?.resolved_id ?? chat?.id
  return id ? sessionMessages(bot, id) : []
}
const lastReply = async (bot = BOT): Promise<string> => [...await chatRows(bot)].reverse().find(r => r.role === 'assistant')?.content ?? ''

async function ask(text: string, bot = BOT, timeout = REPLY_MS): Promise<string> {
  const before = (await chatRows(bot)).filter(r => r.role === 'assistant').length
  await send(page, text)
  await expect.poll(async () => (await chatRows(bot)).filter(r => r.role === 'assistant').length, { timeout }).toBeGreaterThan(before)
  await waitIdle(page, bot, timeout)
  const reply = await lastReply(bot)
  test.info().annotations.push({ type: text, description: reply })
  return reply
}

/** Style checks are soft: the run still fails, but every later turn is still asked and recorded. */
function plain(reply: string, max: number): void {
  expect.soft(sentences(reply), reply).toBeLessThanOrEqual(max)
  for (const re of FORBIDDEN) expect.soft(reply, `${re}`).not.toMatch(re)
}

const memorySize = async (): Promise<number> => {
  const body = (await hermesRest('GET', `/api/memory?profile=${BOT}`)).body as { builtin_files?: Record<string, number> }
  return Object.values(body.builtin_files ?? {}).reduce((a, b) => a + b, 0)
}

/** A Soul save makes Hermes rebuild the chat's prompt, so a saved memory is in the next turn's prompt. */
async function rebuild(): Promise<void> {
  const detail = (await crewApi(page, 'GET', `/crew/bots/${BOT}`)).body as { soul: string }
  expect((await crewApi(page, 'PATCH', `/crew/bots/${BOT}`, { soul: `${detail.soul}\n`, baseline: { soul: detail.soul } })).status).toBe(200)
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ storageState: '.auth/crew.json' })).newPage()
  const usage = (await crewApi(page, 'GET', '/crew/usage')).body as { state?: string; remaining?: number | null }
  test.skip(!(usage.state === 'ok' && typeof usage.remaining === 'number' && usage.remaining > MIN_CREDIT), 'credit is unknown or at or below $0.20')
})

test.afterAll(async () => {
  await page?.context().close()
  await deleteTestBots()
})

const BOXED = `e2e${stamp}5`

test('@model a sandboxed bot browses with the Browser on its own screen, not a terminal hack', async () => {
  test.setTimeout(900_000)
  const made = await crewApi(page, 'POST', '/crew/bots', { name: BOXED, title: 'Boxed', mission: 'Look things up on the web', avatar: { type: 'circle' }, model: MODEL, sandbox: true })
  expect(made.status).toBe(201)
  await openBot(page, BOXED)
  const reply = await ask('Open example.com in the browser on your computer and tell me the main heading on the page.', BOXED, 600_000)
  expect(reply).toMatch(/Example Domain/i)
  plain(reply, 3)
  const rows = await chatRows(BOXED)
  const work = JSON.stringify(rows.filter(r => r.role !== 'user'))
  test.info().annotations.push({ type: 'tools used', description: [...new Set(work.match(/computer_use|terminal|browser_[a-z]+|execute_code/g) ?? [])].join(', ') })
  expect(work).not.toMatch(/--no-sandbox|playwright\/chromium|XAUTHORITY=/)
  // It used its screen, not a page fetch from a terminal.
  expect(work).toContain('computer_use')
  expect(work).not.toMatch(/\bcurl\b|\bwget\b|urllib|requests\.get/)
})
