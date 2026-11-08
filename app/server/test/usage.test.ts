import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { signSession } from '../src/auth/session-cookie.js'
import { setLogSink } from '../src/log.js'
import { createUsageSource, parseEnvKey } from '../src/usage/openrouter.js'
import { HOST, makeDeps } from './helpers.js'

const KEY = 'sk-or-v1-supersecretkey'
let envFile: string
let now = 1_000_000
let lines: string[]
let restore: () => void

beforeEach(() => {
  envFile = join(mkdtempSync(join(tmpdir(), 'crew-usage-')), '.env')
  writeFileSync(envFile, `# comment\nOTHER=1\nOPENROUTER_API_KEY="${KEY}"\n`)
  now = 1_000_000
  lines = []
  restore = setLogSink(l => lines.push(l))
})
afterEach(() => restore())

const keyReply = (over: Record<string, unknown> = {}) =>
  new Response(JSON.stringify({ data: { limit: 5, usage: 3.18, limit_remaining: 1.82, ...over } }), { status: 200 })

function source(fetchFn: typeof fetch) {
  return createUsageSource({ envFile, fetch: fetchFn, now: () => now })
}

describe('parseEnvKey', () => {
  it('reads plain, quoted and exported values and ignores comments', () => {
    expect(parseEnvKey('A=1\nOPENROUTER_API_KEY=abc\n', 'OPENROUTER_API_KEY')).toBe('abc')
    expect(parseEnvKey("export OPENROUTER_API_KEY='abc'\n", 'OPENROUTER_API_KEY')).toBe('abc')
    expect(parseEnvKey('# OPENROUTER_API_KEY=nope\n', 'OPENROUTER_API_KEY')).toBeNull()
  })
})

describe('usage source', () => {
  it('returns remaining credit from the key endpoint', async () => {
    const fetchFn = vi.fn(async (..._a: Parameters<typeof fetch>) => keyReply())
    const usage = await source(fetchFn as unknown as typeof fetch).get()
    expect(usage).toEqual({ state: 'ok', limit: 5, used: 3.18, remaining: 1.82, checkedAt: 1_000_000 })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(String(url)).toBe('https://openrouter.ai/api/v1/key')
    expect((init?.headers as Record<string, string>).Authorization).toBe(`Bearer ${KEY}`)
  })

  it('serves cached values within 60 s and refreshes after', async () => {
    const fetchFn = vi.fn(async () => keyReply())
    const s = source(fetchFn as unknown as typeof fetch)
    await s.get()
    now += 59_000
    await s.get()
    expect(fetchFn).toHaveBeenCalledTimes(1)
    now += 2_000
    await s.get()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('returns stale with the last values when a refresh fails', async () => {
    let fail = false
    const fetchFn = vi.fn(async () => { if (fail) throw new Error('network down'); return keyReply() })
    const s = source(fetchFn as unknown as typeof fetch)
    await s.get()
    fail = true
    now += 61_000
    expect(await s.get()).toEqual({ state: 'stale', limit: 5, used: 3.18, remaining: 1.82, checkedAt: 1_000_000 })
  })

  it('returns unavailable with nulls when it never succeeded', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 401 }))
    expect(await source(fetchFn as unknown as typeof fetch).get()).toEqual({ state: 'unavailable', limit: null, used: null, remaining: null, checkedAt: null })
  })

  it('treats a malformed reply or a missing key as a failure', async () => {
    const bad = vi.fn(async () => new Response(JSON.stringify({ data: { limit: 'x' } }), { status: 200 }))
    expect((await source(bad as unknown as typeof fetch).get()).state).toBe('unavailable')
    writeFileSync(envFile, 'OTHER=1\n')
    const none = vi.fn(async () => keyReply())
    expect((await source(none as unknown as typeof fetch).get()).state).toBe('unavailable')
    expect(none).not.toHaveBeenCalled()
  })

  it('accepts null limits (unlimited key)', async () => {
    const fetchFn = vi.fn(async () => keyReply({ limit: null, limit_remaining: null }))
    expect(await source(fetchFn as unknown as typeof fetch).get()).toMatchObject({ state: 'ok', limit: null, remaining: null, used: 3.18 })
  })

  it('picks up a rotated key on the next refresh', async () => {
    const fetchFn = vi.fn(async (..._a: Parameters<typeof fetch>) => keyReply())
    const s = source(fetchFn as unknown as typeof fetch)
    await s.get()
    writeFileSync(envFile, 'OPENROUTER_API_KEY=sk-new\n')
    now += 61_000
    await s.get()
    expect((fetchFn.mock.calls[1]![1]?.headers as Record<string, string>).Authorization).toBe('Bearer sk-new')
  })

  it('never exposes the key in responses, errors or logs', async () => {
    const failing = vi.fn(async () => { throw new Error(`boom with ${KEY}`) })
    const base = makeDeps()
    const cookie = `crew_session=${signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })}`
    const app = createApp({ ...base, usage: source(failing as unknown as typeof fetch) })
    const res = await app.request('/crew/usage', { headers: { Host: HOST, Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(JSON.parse(body).state).toBe('unavailable')
    expect(body + lines.join('\n')).not.toContain(KEY)
    const ok = createApp({ ...base, usage: source((async () => keyReply()) as unknown as typeof fetch) })
    const okBody = await (await ok.request('/crew/usage', { headers: { Host: HOST, Cookie: cookie } })).text()
    expect(okBody + lines.join('\n')).not.toContain(KEY)
  })

  it('requires a session', async () => {
    const app = createApp({ ...makeDeps(), usage: source((async () => keyReply()) as unknown as typeof fetch) })
    expect((await app.request('/crew/usage', { headers: { Host: HOST } })).status).toBe(401)
  })
})
