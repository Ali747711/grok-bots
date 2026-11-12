import { type Page, expect, test } from '@playwright/test'

import { CREW, crewApi, deleteTestBots, openBot, send, waitIdle } from './helpers.js'
import { hermesRest, profileRows, sessionMessages } from './hermes-rpc.js'

// SPENDS CREDIT: about 9 short model turns. Controller-only, run once (voice plan Task 9 / spec §6).
// The bot has no apps on purpose, so "Can you see my apps?" must say none.

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

async function chatRows(): Promise<{ role: string; content: string }[]> {
  const chat = (await profileRows()).find(p => p.name === BOT)?.canonical_session as { id?: string; resolved_id?: string } | null | undefined
  const id = chat?.resolved_id ?? chat?.id
  return id ? sessionMessages(BOT, id) : []
}
const lastReply = async (): Promise<string> => [...await chatRows()].reverse().find(r => r.role === 'assistant')?.content ?? ''

async function ask(text: string): Promise<string> {
  const before = (await chatRows()).filter(r => r.role === 'assistant').length
  await send(page, text)
  await expect.poll(async () => (await chatRows()).filter(r => r.role === 'assistant').length, { timeout: REPLY_MS }).toBeGreaterThan(before)
  await waitIdle(page, BOT, REPLY_MS)
  const reply = await lastReply()
  test.info().annotations.push({ type: text, description: reply })
  return reply
}

function plain(reply: string, max: number): void {
  expect(sentences(reply), reply).toBeLessThanOrEqual(max)
  for (const re of FORBIDDEN) expect(reply, `${re}`).not.toMatch(re)
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
  const mate = await crewApi(page, 'POST', '/crew/bots', { name: MATE, title: MATE_TITLE, mission: 'Writes release notes', avatar: { type: 'circle' } })
  expect(mate.status).toBe(201)
  const made = await crewApi(page, 'POST', '/crew/bots', {
    name: BOT, title: 'Voice Model', mission: 'Help me plan my week', avatar: { type: 'circle' }, model: MODEL, firstRun: true
  })
  expect(made.status).toBe(201)
  const routine = await crewApi(page, 'POST', `/crew/routines?bot=${BOT}`, {
    title: ROUTINE, instruction: 'Summarise my inbox', schedule: { kind: 'daily', time: '08:00' }, timezone: 'UTC', deliverToChat: true
  })
  expect(routine.status).toBe(201)
  expect((await crewApi(page, 'POST', `/crew/routines/${routine.body.id}/pause?bot=${BOT}`)).status).toBe(200)
})

test.afterAll(async () => {
  await page?.context().close()
  await deleteTestBots()
})

test('@model a Grok-style bot: greets once, knows itself, remembers and forgets', async () => {
  test.setTimeout(1_800_000)
  // Turn 1: the first run (hidden prompt, visible reply only).
  await expect.poll(async () => (await chatRows()).some(r => r.role === 'assistant'), { timeout: REPLY_MS }).toBe(true)
  await waitIdle(page, BOT, REPLY_MS)
  const greeting = await lastReply()
  test.info().annotations.push({ type: 'first run', description: greeting })
  plain(greeting, 2)
  await openBot(page, BOT)
  await expect(page.getByTestId('transcript')).not.toContainText('First run, not from your owner')

  // Turns 2-5: self-knowledge from the Right-now block, no probing.
  expect(await ask('Can you see my apps?')).toMatch(/no(ne| apps|t connected| connected)|don't have any|haven't/i)
  plain(await lastReply(), 3)
  expect(await ask('Can you use your computer?')).toMatch(/\byes\b|\bI can\b|I have/i)
  plain(await lastReply(), 3)
  const routines = await ask('What routines do you have?')
  expect(routines).toMatch(new RegExp(ROUTINE, 'i'))
  expect(routines).toMatch(/paused/i)
  plain(routines, 3)
  const mates = await ask('Who else is here?')
  expect(mates).toContain(MATE_TITLE)
  plain(mates, 3)

  // Turns 6-9: remember, recall after a prompt rebuild, forget, recall again.
  const before = await memorySize()
  await ask(`Remember that my favourite fruit is ${FRUIT}.`)
  await expect.poll(memorySize, { timeout: 60_000 }).toBeGreaterThan(before)
  await rebuild()
  expect((await ask("What's my favourite fruit?")).toLowerCase()).toContain(FRUIT)
  const remembered = await memorySize()
  await ask('Forget my favourite fruit.')
  await expect.poll(memorySize, { timeout: 60_000 }).toBeLessThan(remembered)
  await rebuild()
  expect((await ask("What's my favourite fruit?")).toLowerCase()).not.toContain(FRUIT)
  // The stored prompt carries Crew's chat-app hint (platform_hints.cli.replace), proven without a turn of its own.
  const sessions = (await hermesRest('GET', `/api/sessions?profile=${BOT}&full=1`)).body as { sessions?: { system_prompt?: string }[] }
  expect(JSON.stringify(sessions)).toContain("You're chatting with your owner in a chat app.")
  test.info().annotations.push({ type: 'page', description: CREW })
})
