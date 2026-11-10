import { type Page, expect, test } from '@playwright/test'

import { CREW, appsOff, appsStatus, crewApi, deleteTestBots, envKeyNames, rawAppsServer } from './helpers.js'
import { hermesRest, withRpc } from './hermes-rpc.js'

// No model calls. Run by the controller against the deployed build, with the Composio key already saved in Crew.
// Only e2e<digits> bots are touched. The key is never read: the specs see only Crew's replies and Hermes's key names.

test.describe.configure({ mode: 'serial' })

const stamp = Date.now()
const A = `e2e${stamp}`
const B = `e2e${stamp + 1}`
const SPA_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"
const RECONNECT_MS = 150_000
const SWEEP_MS = 90_000
const TOKEN_ENV = 'MCP_CREW_APPS_API_KEY'

let page: Page

interface AppsView { apps: { toolkit: string; tools: number }[] }
interface AppsList { apps: { id: string; toolkit: string; status: string }[]; usage: Record<string, string[]> }

const putApps = (bot: string, body: Record<string, string>) => crewApi(page, 'PUT', `/crew/bots/${bot}/apps`, body)
const githubTools = (view: unknown): number => (view as AppsView).apps.find(a => a.toolkit === 'github')?.tools ?? -1
const githubUsage = async (): Promise<string[]> => ((await crewApi(page, 'GET', '/crew/connectors/apps')).body as AppsList).usage.github ?? []

/** The relay as a bot makes it: Node fetch, so no cookie and no Origin. */
async function relay(method: string, path: string, token?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${CREW}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) },
    ...(method === 'POST' ? { body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' } : {})
  })
  const text = await res.text()
  let body: unknown = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

test.beforeAll(async ({ browser }) => {
  const ctx = await browser.newContext({ storageState: '.auth/crew.json' })
  page = await ctx.newPage()
  await page.goto(CREW)
  const key = await crewApi(page, 'GET', '/crew/connectors/key')
  test.skip(key.status !== 200 || key.body?.configured !== true, 'no Composio key is saved in Crew')
  await deleteTestBots()
  for (const [name, title] of [[A, `E2E Apps A ${stamp}`], [B, `E2E Apps B ${stamp}`]] as const) {
    const made = await crewApi(page, 'POST', '/crew/bots', { name, title, avatar: { type: 'circle' } })
    expect(made.status).toBeLessThan(300)
  }
})

test.afterAll(async () => {
  if (page) {
    await appsOff(page, A)
    await appsOff(page, B)
    await page.context().close()
  }
  await deleteTestBots()
})

test('the key reads back only as configured, and a wrong key is refused without replacing it', async () => {
  const got = await crewApi(page, 'GET', '/crew/connectors/key')
  expect(got.status).toBe(200)
  expect(got.body).toEqual({ configured: true })
  const put = await crewApi(page, 'PUT', '/crew/connectors/key', { key: 'ak_e2e_not_a_real_key' })
  expect(put.status).toBe(409)
  expect(put.body).toEqual({ error: 'key_rejected' })
  expect((await crewApi(page, 'GET', '/crew/connectors/key')).body).toEqual({ configured: true })
})

test('toolkit search finds github and the apps list answers', async () => {
  const found = await crewApi(page, 'GET', '/crew/connectors/toolkits?search=github')
  expect(found.status).toBe(200)
  expect(JSON.stringify(found.body)).toContain('github')
  expect((await crewApi(page, 'GET', '/crew/connectors/apps')).status).toBe(200)
})

test('connect gives a Composio sign-in link (then revokes it), or says GitHub is already connected', async () => {
  const res = await crewApi(page, 'POST', '/crew/connectors/connect', { toolkit: 'github' })
  if (res.status === 409) {
    expect(res.body).toEqual({ error: 'already_connected' })
    return
  }
  expect(res.status).toBe(200)
  const url = new URL(res.body.redirectUrl as string)
  expect(url.protocol).toBe('https:')
  expect(url.hostname).toMatch(/(^|\.)composio\.dev$/)
  expect(typeof res.body.connectionId).toBe('string')
  expect((await crewApi(page, 'DELETE', `/crew/connectors/apps/${encodeURIComponent(res.body.connectionId as string)}`)).status).toBe(204)
})

test('Read only adds an untrusted crew_apps server with a bearer env reference and only the token key', async () => {
  const put = await putApps(A, { github: 'read' })
  expect(put.status).toBe(200)
  const count = githubTools(put.body)
  expect(count).toBeGreaterThan(0)
  const server = await rawAppsServer(A)
  expect(server).toMatchObject({
    trust: 'untrusted',
    url: `http://127.0.0.1:7070/mcp/${A}`,
    headers: { Authorization: `Bearer \${${TOKEN_ENV}}` }
  })
  const names = await envKeyNames(A)
  expect(names).toContain(TOKEN_ENV)
  expect(names.filter(n => /COMPOSIO/i.test(n))).toEqual([])
  const probe = await withRpc(rpc =>
    rpc.call<{ ok: boolean; tools: { name: string }[] }>('mcp.servers.test', { profile: A, name: 'crew_apps' }))
  expect(probe.ok).toBe(true)
  expect(probe.tools).toHaveLength(count)
  const tools = probe.tools.map(t => t.name)
  expect(tools).toContain('GITHUB_GET_THE_AUTHENTICATED_USER')
  expect(tools).not.toContain('GITHUB_CREATE_AN_ISSUE')
})

test('a level change reaches Hermes as the new tool set', async () => {
  const put = await putApps(A, { github: 'change' })
  expect(put.status).toBe(200)
  const count = githubTools(put.body)
  await expect.poll(async () => {
    const status = await appsStatus(A)
    return status?.connected === true && status.tools === count
  }, { timeout: RECONNECT_MS, intervals: [3000] }).toBe(true)
})

test('the relay refuses a missing or wrong token and never asks for a session', async () => {
  for (const method of ['POST', 'GET', 'DELETE']) {
    for (const token of [undefined, 'not-the-token']) {
      const res = await relay(method, `/mcp/${A}`, token)
      expect(res.status, `${method} ${token ? 'wrong' : 'no'} token`).toBe(401)
      expect(res.body).toEqual({ error: 'bad_token' })
    }
  }
  const nested = await relay('POST', `/mcp/${A}/x`)
  expect(nested.status).toBe(401)
  expect(nested.body).toEqual({ error: 'login_required' })
})

test('turning apps off removes the server, the token and the usage entry', async () => {
  expect((await putApps(A, {})).status).toBe(200)
  expect(await rawAppsServer(A)).toBeUndefined()
  expect(await envKeyNames(A)).not.toContain(TOKEN_ENV)
  expect(await githubUsage()).not.toContain(A)
})

test('a bot deleted through Hermes leaves the usage list within 90 s', async () => {
  expect((await putApps(B, { github: 'read' })).status).toBe(200)
  await expect.poll(githubUsage, { timeout: 30_000 }).toContain(B)
  const gone = await hermesRest('DELETE', `/api/profiles/${B}`)
  expect(gone.status).toBeLessThan(300)
  await expect.poll(githubUsage, { timeout: SWEEP_MS, intervals: [3000] }).not.toContain(B)
})

test('the connector routes need the guards, and the CSP is unchanged', async () => {
  const noOrigin = await fetch(`${CREW}/crew/connectors/key`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{"key":"ak_e2e_not_a_real_key"}' })
  expect(noOrigin.status).toBe(403)
  const noCookie = await fetch(`${CREW}/crew/connectors/apps`)
  expect(noCookie.status).toBe(401)
  const root = await page.request.get(`${CREW}/`)
  expect(root.headers()['content-security-policy']).toBe(SPA_CSP)
})
