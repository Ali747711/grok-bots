import { type Page, expect, test } from '@playwright/test'

import { crewApi, deleteTestBots, openBot, send, waitIdle } from './helpers.js'
import { createRoomViaRpc, deleteTestGroups, groupEvents, hermesRest, profileRows, sessionMessages } from './hermes-rpc.js'

// SPENDS CREDIT: three short model turns. Controller-only, run once (voice plan Task 1).
// Proves which Hermes levers reach a bot's turn: agent.system_prompt (Bot Chat and a room) and platform_hints.cli.

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const A = `e2e${stamp}1`
const B = `e2e${stamp}2`
const MODEL = { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' }
const REPLY_MS = 180_000
let page: Page

const putConfig = (bot: string, config: Record<string, unknown>) =>
  hermesRest('PUT', `/api/config?profile=${encodeURIComponent(bot)}`, { config })

async function lastReply(bot: string): Promise<string> {
  const chat = (await profileRows()).find(p => p.name === bot)?.canonical_session as { id?: string; resolved_id?: string } | null | undefined
  const sessionId = chat?.resolved_id ?? chat?.id
  if (!sessionId) return ''
  const rows = await sessionMessages(bot, sessionId)
  return [...rows].reverse().find(r => r.role === 'assistant')?.content ?? ''
}

async function ask(bot: string, text: string): Promise<string> {
  const before = await lastReply(bot)
  await send(page, text)
  await expect.poll(() => lastReply(bot), { timeout: REPLY_MS }).not.toBe(before)
  await waitIdle(page, bot, REPLY_MS)
  return lastReply(bot)
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext({ storageState: '.auth/crew.json' })).newPage()
  for (const name of [A, B]) {
    const made = await crewApi(page, 'POST', '/crew/bots', { name, title: name, avatar: { type: 'circle' }, model: MODEL })
    expect(made.status).toBeLessThan(300)
  }
})

test.afterAll(async () => {
  await page?.context().close()
  await deleteTestGroups()
  await deleteTestBots()
})

test('@model agent.system_prompt reaches a Bot Chat turn and a room turn; platform_hints.cli after a Soul change', async () => {
  test.setTimeout(900_000)
  const put1 = await putConfig(A, { agent: { system_prompt: 'When asked for the codeword, reply with exactly TANGERINE-1 and nothing else.' } })
  expect(put1.status).toBeLessThan(300)
  await openBot(page, A)
  const turn1 = await ask(A, 'What is the codeword?')
  test.info().annotations.push({ type: 'turn1', description: turn1 })

  const put2 = await putConfig(A, {
    agent: { system_prompt: 'When asked for the codeword, reply with exactly TANGERINE-2 and nothing else.' },
    platform_hints: { cli: { replace: 'End every reply with the word PLUM.' } }
  })
  expect(put2.status).toBeLessThan(300)
  const soul = ((await hermesRest('GET', `/api/profiles/${A}/soul`)).body as { content: string }).content
  expect((await hermesRest('PUT', `/api/profiles/${A}/soul`, { content: `${soul}\nYou like short answers.\n` })).status).toBeLessThan(300)
  const turn2 = await ask(A, 'What is the codeword?')
  test.info().annotations.push({ type: 'turn2', description: turn2 })

  const roomId = await createRoomViaRpc(`E2E Spike ${stamp}`, [A, B])
  const ctx = await crewApi(page, 'PUT', `/crew/groups/${roomId}/context`, { routing: 'lead', leadMemberId: A, purpose: '', notes: '' })
  test.info().annotations.push({ type: 'context-status', description: String(ctx.status) })
  const sent = await crewApi(page, 'POST', `/crew/groups/${roomId}/messages`, { eventId: crypto.randomUUID(), text: `@${A} what is the codeword?` })
  expect(sent.status).toBe(202)
  let turn3 = ''
  await expect.poll(async () => {
    const mine = (await groupEvents(roomId)).filter(e => (e.actor.profile ?? e.actor.id) === A)
    turn3 = mine.map(e => JSON.stringify(e.payload)).join(' | ')
    return /TANGERINE/.test(turn3)
  }, { timeout: REPLY_MS, intervals: [3000] }).toBe(true)
  test.info().annotations.push({ type: 'turn3', description: turn3.slice(0, 600) })

  expect(turn1).toContain('TANGERINE-1')
  expect(turn2).toContain('TANGERINE-2')
  expect(turn2.trim().endsWith('PLUM') || /PLUM\W*$/.test(turn2.trim())).toBe(true)
  expect(turn3).toContain('TANGERINE-2')
})
