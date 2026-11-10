import { execFileSync } from 'node:child_process'
import { homedir, hostname } from 'node:os'

import { type Page, expect, test } from '@playwright/test'

import { CREW, containersOf, crewApi, crewState, deleteTestBots, openBot, send, waitIdle } from './helpers.js'
import { profileRows, sessionMessages } from './hermes-rpc.js'

// SPENDS CREDIT: one real model turn (Haiku) on a sandboxed e2e bot. Every test is tagged @model.
// Controller-only, run ONCE. Implementers must never run this file (check it with --list only).

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const BOT = `e2e${stamp}`
const MIN_CREDIT = 0.12
const HOME = homedir()
const SCRIPT =
  `id; hostname; test -r ${HOME}/.hermes/.env && echo LEAK_ENV || echo no_env; ` +
  `test -r ${HOME}/.hermes/webapp/session-token && echo LEAK_TOKEN || echo no_token; ` +
  `test -e ${HOME}/.config/crew && echo LEAK_CREW || echo no_crew; ` +
  'for t in 127.0.0.1/9120 127.0.0.1/7070 172.17.0.1/9120 172.17.0.1/7070; do ' +
  'timeout 3 bash -c "echo > /dev/tcp/$t" 2>/dev/null && echo "OPEN $t" || echo "closed $t"; done'
const PROMPT = `Run exactly this command with the terminal tool, then reply with its raw output and nothing else:\n\n${SCRIPT}`

let page: Page

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: '.auth/crew.json' })
  page = await ctx.newPage()
  await page.goto(CREW)
  const usage = (await crewApi(page, 'GET', '/crew/usage')).body as { state?: string; remaining?: number | null }
  test.skip(usage.state === 'ok' && typeof usage.remaining === 'number' && usage.remaining <= MIN_CREDIT, 'credit is at or below $0.12')
  await deleteTestBots()
  const made = await crewApi(page, 'POST', '/crew/bots', {
    name: BOT,
    title: `E2E Sandbox Model ${stamp}`,
    sandbox: true,
    model: { provider: 'openrouter', model: 'anthropic/claude-haiku-5.5' }
  })
  expect(made.status).toBeLessThan(300)
})

test.afterAll(async () => {
  if (page) {
    const res = await crewApi(page, 'DELETE', `/crew/bots/${BOT}`)
    if (res.status !== 204) test.info().annotations.push({ type: 'delete-status', description: String(res.status) })
  }
  await deleteTestBots()
})

test('@model a sandboxed bot runs as the host user and cannot reach keys, tokens or Crew', async () => {
  await openBot(page, BOT)
  await send(page, PROMPT)
  await waitIdle(page, BOT)
  const chat = (await profileRows()).find(p => p.name === BOT)?.canonical_session as { id?: string; resolved_id?: string } | null | undefined
  const sessionId = chat?.resolved_id ?? chat?.id
  expect(sessionId, 'the bot has a canonical session').toBeTruthy()
  const text = (await sessionMessages(BOT, sessionId!)).map(m => m.content).join('\n')
  for (const needle of ['uid=1000', 'no_env', 'no_token', 'no_crew']) expect(text).toContain(needle)
  for (const t of ['127.0.0.1/9120', '127.0.0.1/7070', '172.17.0.1/9120', '172.17.0.1/7070']) expect(text).toContain(`closed ${t}`)
  expect(text).not.toContain('LEAK_')
  expect(text).not.toContain('OPEN ')
  expect(text).not.toContain(hostname())
  await expect(page.getByText('uid=1000').first()).toBeVisible()
  expect((await crewState(page)).pending.filter(p => (p as { profile?: string }).profile === BOT)).toEqual([])
  const [container] = containersOf(BOT)
  expect(container, 'the bot has a container').toBeTruthy()
  const user = execFileSync('docker', ['inspect', '--format', '{{.Config.User}}', container!], { encoding: 'utf8', timeout: 5000 }).trim()
  expect(user).toBe('1000:1000')
})
