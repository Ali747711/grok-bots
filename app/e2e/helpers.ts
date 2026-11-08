import { execFileSync } from 'node:child_process'

import { type Page, expect } from '@playwright/test'

import { hermesRest, testBotNames } from './hermes-rpc.js'

export const VM = 'ali@192.168.64.16'
export const CREW = 'http://127.0.0.1:7070'

/** Run a command in the VM and return trimmed stdout. */
export function vm(cmd: string): string {
  return execFileSync('ssh', ['-o', 'BatchMode=yes', VM, cmd], { encoding: 'utf8' }).trim()
}

export function crewLoginUrl(): string {
  const out = vm('node ~/projects/grok-bots/app/server/dist/cli/crew.js login')
  const url = out.match(/http:\/\/127\.0\.0\.1:7070\/login#ticket=[A-Za-z0-9_-]+/)?.[0]
  if (!url) throw new Error(`no crew login link in: ${out}`)
  return url
}

export function webappLoginUrl(): string {
  const out = vm('export PATH=$HOME/.local/bin:$PATH; hermes webapp --no-open --skip-build 2>&1')
  const url = out.match(/http:\/\/127\.0\.0\.1:9120\/webapp\/launch#ticket=[A-Za-z0-9_-]+/)?.[0]
  if (!url) throw new Error(`no webapp link in: ${out}`)
  return url
}

export const dirExists = (path: string) => vm(`test -d ${path} && echo yes || echo no`) === 'yes'
export const makeDir = (path: string) => vm(`mkdir -p ${path}`)

export async function openBot(page: Page, name: string): Promise<void> {
  await page.goto(`${CREW}/bots/${name}`)
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send' })).toBeVisible()
}

/** Send a chat message from the Crew composer once sending is allowed. */
export async function send(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' })
  await expect(box).toBeEnabled({ timeout: 30_000 })
  await box.fill(text)
  await box.press('Enter')
}

export async function crewState(page: Page): Promise<{ hermes: string; bots: { name: string; status: string }[]; pending: unknown[] }> {
  const res = await page.request.get(`${CREW}/crew/state`)
  expect(res.status()).toBe(200)
  return res.json()
}

export async function waitIdle(page: Page, bot: string, timeoutMs = 120_000): Promise<void> {
  await expect.poll(async () => (await crewState(page)).bots.find(b => b.name === bot)?.status, { timeout: timeoutMs }).toBe('idle')
}

/** Delete every profile whose handle is `e2e<digits>` (test-owned bots, incl. leftovers of a failed run). Nothing else is touched. */
export async function deleteTestBots(): Promise<string[]> {
  const list = await hermesRest('GET', '/api/profiles')
  const rows = (list.body as { profiles?: { name: string }[] } | null)?.profiles ?? []
  const names = testBotNames(rows.map(r => r.name))
  for (const name of names) await hermesRest('DELETE', `/api/profiles/${encodeURIComponent(name)}`)
  return names
}
