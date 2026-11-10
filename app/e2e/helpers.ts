import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { lstatSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { type Locator, type Page, expect } from '@playwright/test'

import { hermesRest, testBotNames, withRpc } from './hermes-rpc.js'

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
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible()
}

/** Send a chat message from the Crew composer once sending is allowed. */
export async function send(page: Page, text: string): Promise<void> {
  const box = page.getByRole('textbox', { name: 'Message' })
  await expect(box).toBeEnabled({ timeout: 30_000 })
  await box.fill(text)
  await box.press('Enter')
}

/** Open a routine row's accordion (the switch, Edit, History, Delete and Triggers live in it) unless it is open already. */
export async function expandRoutine(row: Locator): Promise<void> {
  const toggle = row.getByRole('button', { name: 'Routine details' })
  await expect(toggle).toBeVisible()
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

export async function crewState(page: Page): Promise<{ hermes: string; bots: { name: string; status: string }[]; pending: unknown[] }> {
  const res = await page.request.get(`${CREW}/crew/state`)
  expect(res.status()).toBe(200)
  return res.json()
}

export async function waitIdle(page: Page, bot: string, timeoutMs = 120_000): Promise<void> {
  await expect.poll(async () => (await crewState(page)).bots.find(b => b.name === bot)?.status, { timeout: timeoutMs }).toBe('idle')
}

const E2E_BOT_RE = /^e2e\d+$/
const SANDBOX_IMAGE = 'nousresearch/hermes-sandbox:desktop'
const DOCKER_TIMEOUT_MS = 5000
const CLEANUP_TIMEOUT_MS = 60_000

/** The e2e runs on the VM, so docker is local: a fixed argv through execFileSync, never a shell. */
const docker = (argv: readonly string[], timeout = DOCKER_TIMEOUT_MS): string =>
  execFileSync('docker', [...argv], { encoding: 'utf8', timeout, killSignal: 'SIGKILL' }).trim()

function assertTestBot(name: string): void {
  if (!E2E_BOT_RE.test(name)) throw new Error('test sandboxes belong to e2e<digits> bots only')
}

/** Container ids carrying `hermes-profile=<bot>` (the label Hermes puts on a sandboxed bot's container). */
export function containersOf(bot: string): string[] {
  assertTestBot(bot)
  return docker(['ps', '-aq', '--filter', `label=hermes-profile=${bot}`]).split('\n').filter(Boolean)
}

/** Ids of leftover cleanup-helper containers (label `crew-cleanup`), whatever bot they name. */
export function cleanupContainers(): string[] {
  return docker(['ps', '-aq', '--filter', 'label=crew-cleanup']).split('\n').filter(Boolean)
}

const isRealDir = (path: string): boolean => {
  try {
    return lstatSync(path).isDirectory()
  } catch {
    return false
  }
}

/** True when `~/.hermes/profiles/<bot>/sandboxes/docker` exists as a real folder (not a symlink). */
export const hasSandboxFolder = (bot: string): boolean => {
  const dir = join(homedir(), '.hermes', 'profiles', bot, 'sandboxes')
  return isRealDir(dir) && isRealDir(join(dir, 'docker'))
}

/**
 * Remove a test bot's containers and its root-owned `sandboxes/docker` folder, so Hermes can delete the profile.
 * The helper argv is the same as the server's `cleanupArgs` (app/server/src/sandbox/docker.ts).
 */
export function removeTestSandbox(name: string): void {
  assertTestBot(name)
  for (const id of containersOf(name)) docker(['rm', '-f', id])
  if (!hasSandboxFolder(name)) return
  const sandboxes = join(homedir(), '.hermes', 'profiles', name, 'sandboxes')
  try {
    docker(['image', 'inspect', SANDBOX_IMAGE])
  } catch {
    // `docker run` would download the 1.2 GB image unasked.
    throw new Error('The sandbox image is not downloaded; refusing to let docker run pull it')
  }
  docker([
    'run', '--rm', '--network', 'none', '--user', '0:0', '--label', `crew-cleanup=${name}`,
    '--entrypoint', 'rm', '-v', `${sandboxes}:/s`, SANDBOX_IMAGE, '-rf', '/s/docker'
  ], CLEANUP_TIMEOUT_MS)
}

/** Remove every container labelled for an `e2e<digits>` bot, including orphans of bots already gone. */
function removeOrphanContainers(): void {
  const rows = docker(['ps', '-a', '--filter', 'label=hermes-profile', '--format', '{{.ID}} {{.Label "hermes-profile"}}'])
  for (const row of rows.split('\n')) {
    const [id, bot] = row.trim().split(/\s+/)
    if (id && bot && E2E_BOT_RE.test(bot)) docker(['rm', '-f', id])
  }
}

/** Delete every profile whose handle is `e2e<digits>` (test-owned bots, incl. leftovers of a failed run). Nothing else is touched. */
export async function deleteTestBots(): Promise<string[]> {
  try {
    removeOrphanContainers()
  } catch {
    // Docker may be absent on a machine that only runs the other specs; the profile delete below still goes on.
  }
  const list = await hermesRest('GET', '/api/profiles')
  const rows = (list.body as { profiles?: { name: string }[] } | null)?.profiles ?? []
  const names = testBotNames(rows.map(r => r.name))
  for (const name of names) {
    try {
      removeTestSandbox(name)
    } catch {
      // Without Docker a never-sandboxed bot has nothing to clean; a sandboxed one is left for the next run.
      // Hermes's own DELETE would fail on the root-owned folders and drop the bot from the roster (gotcha 24).
      if (hasSandboxFolder(name)) continue
    }
    await hermesRest('DELETE', `/api/profiles/${encodeURIComponent(name)}`)
  }
  return names
}

/** Create a bot through the New bot dialog with a chosen handle (test-owned: `e2e<digits>`), and wait until Crew opens it. */
export async function createBotInDialog(page: Page, title: string, handle: string, opts: { sandbox?: boolean } = {}): Promise<void> {
  await page.goto(CREW)
  await page.getByRole('button', { name: '+ New bot', exact: true }).click()
  await page.getByLabel('Name', { exact: true }).fill(title)
  await page.getByRole('button', { name: 'Change handle', exact: true }).click()
  await page.getByLabel('Handle').fill(handle)
  if (opts.sandbox) await page.getByRole('checkbox', { name: 'Run in a sandbox' }).click()
  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/bots/${handle}$`), { timeout: 120_000 })
}

/** A request to Crew's API as the logged-in page: the Origin and CSRF header the browser sends on writes. */
export async function crewApi(page: Page, method: string, path: string, data?: unknown): Promise<{ status: number; body: any }> {
  const csrf = (await page.context().cookies(CREW)).find(c => c.name === 'crew_csrf')?.value ?? ''
  const res = await page.request.fetch(`${CREW}${path}`, {
    method,
    headers: { 'X-Crew-CSRF': csrf, Origin: CREW },
    ...(data === undefined ? {} : { data })
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status(), body }
}

/** A hook request exactly as a sender makes it: Node fetch, so no cookie. */
export async function postHook(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { method: 'POST', headers, body })
  const text = await res.text()
  let parsed: unknown = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = text
  }
  return { status: res.status, body: parsed }
}

export const hmacHex = (secret: string, data: string): string => createHmac('sha256', secret).update(data).digest('hex')

export function githubHeaders(body: string, secret: string, event: string, delivery: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    'x-github-event': event,
    'x-github-delivery': delivery,
    'x-hub-signature-256': `sha256=${hmacHex(secret, body)}`
  }
}

/** `ts` null leaves the timestamp header out (the signature then covers `.<body>`). */
export function genericHeaders(body: string, secret: string, ts: string | null, event?: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(ts === null ? {} : { 'x-crew-timestamp': ts }),
    'x-crew-signature': `sha256=${hmacHex(secret, `${ts ?? ''}.${body}`)}`,
    ...(event ? { 'x-crew-event': event } : {})
  }
}

// ---- Connectors (Phase 7). These go only through Crew or Hermes; nothing reads the Composio key or a .env value. ----

/** Turn a bot's apps off (soft: the status is not checked, so cleanup never throws). */
export async function appsOff(page: Page, bot: string): Promise<void> {
  await crewApi(page, 'PUT', `/crew/bots/${encodeURIComponent(bot)}/apps`, {})
}

/** The raw `mcp_servers.crew_apps` entry of a bot's Hermes config, or undefined. */
export async function rawAppsServer(bot: string): Promise<Record<string, unknown> | undefined> {
  const res = await hermesRest('GET', `/api/config?profile=${encodeURIComponent(bot)}&include_defaults=false`)
  const servers = (res.body as { mcp_servers?: Record<string, Record<string, unknown>> } | null)?.mcp_servers
  return servers?.crew_apps
}

/** The names of a bot's env keys. Names only; Hermes redacts the values and this never returns them. */
export async function envKeyNames(bot: string): Promise<string[]> {
  const res = await hermesRest('GET', `/api/env?profile=${encodeURIComponent(bot)}`)
  const body = res.body
  // An unanswered read must fail the test: an empty list would let a "not contains" check pass.
  if (res.status !== 200 || body === null || typeof body !== 'object') throw new Error(`Hermes env read answered ${res.status}`)
  return Object.keys(body as Record<string, unknown>)
}

/** The runtime state of a bot's `crew_apps` server, as Hermes caches it. */
export async function appsStatus(bot: string): Promise<{ connected: boolean; tools: number } | undefined> {
  const res = await withRpc(rpc =>
    rpc.call<{ servers: { name: string; connected: boolean; tools: number }[] }>('mcp.servers.status', { profile: bot }))
  const row = res.servers.find(s => s.name === 'crew_apps')
  return row ? { connected: row.connected, tools: row.tools } : undefined
}
