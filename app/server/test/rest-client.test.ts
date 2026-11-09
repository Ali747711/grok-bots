import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { HermesRestError } from '../src/hermes/errors.js'
import { createHermesRest } from '../src/hermes/rest-client.js'
import { HermesToken } from '../src/hermes/token.js'

async function tokenFile(value: string): Promise<{ token: HermesToken; file: string }> {
  const file = join(await mkdtemp(join(tmpdir(), 'crew-token-')), 'token')
  await writeFile(file, value)
  return { token: new HermesToken(file), file }
}

interface Seen { url: string; method: string; token: string | null; body: string | null }
function scripted(replies: Response[]) {
  const seen: Seen[] = []
  const fetchFn = (async (input: URL | string, init?: RequestInit) => {
    seen.push({ url: String(input), method: init?.method ?? 'GET', token: new Headers(init?.headers).get('x-hermes-session-token'), body: (init?.body as string) ?? null })
    return replies[seen.length - 1]!
  }) as typeof fetch
  return { fetchFn, seen }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('createHermesRest', () => {
  it('sends the token, query and JSON body', async () => {
    const { token } = await tokenFile('tok1')
    const { fetchFn, seen } = scripted([json(200, { ok: true })])
    const rest = createHermesRest({ hermesUrl: 'http://127.0.0.1:9120', token, fetch: fetchFn })
    expect(await rest.request('PUT', '/api/profiles/x/soul', { query: { a: '1' }, body: { content: 'hi' } })).toEqual({ ok: true })
    expect(seen[0]).toEqual({ url: 'http://127.0.0.1:9120/api/profiles/x/soul?a=1', method: 'PUT', token: 'tok1', body: '{"content":"hi"}' })
  })

  it('re-reads the token once on 401', async () => {
    const { token, file } = await tokenFile('old')
    await token.get()
    await writeFile(file, 'new')
    const { fetchFn, seen } = scripted([json(401, { detail: 'no' }), json(200, { ok: 1 })])
    const rest = createHermesRest({ hermesUrl: 'http://h', token, fetch: fetchFn })
    expect(await rest.request('GET', '/api/profiles')).toEqual({ ok: 1 })
    expect(seen.map(s => s.token)).toEqual(['old', 'new'])
  })

  it('does not retry a second 401 and marks the token signed out', async () => {
    const { token } = await tokenFile('t')
    const { fetchFn, seen } = scripted([json(401, { detail: 'a' }), json(401, { detail: 'b' })])
    const rest = createHermesRest({ hermesUrl: 'http://h', token, fetch: fetchFn })
    await expect(rest.request('GET', '/x')).rejects.toMatchObject({ status: 401, detail: 'b' })
    expect(seen).toHaveLength(2)
    expect(token.state).toBe('signed_out')
  })

  it('maps a Hermes error detail', async () => {
    const { token } = await tokenFile('t')
    const { fetchFn } = scripted([json(400, { detail: 'Profile x does not exist.' }), json(500, { error: 'boom' }), json(502, { message: 'bad gw' }), new Response('plain text', { status: 500 })])
    const rest = createHermesRest({ hermesUrl: 'http://h', token, fetch: fetchFn })
    await expect(rest.request('DELETE', '/x')).rejects.toEqual(new HermesRestError(400, 'Profile x does not exist.'))
    await expect(rest.request('GET', '/x')).rejects.toMatchObject({ status: 500, detail: 'boom' })
    await expect(rest.request('GET', '/x')).rejects.toMatchObject({ status: 502, detail: 'bad gw' })
    await expect(rest.request('GET', '/x')).rejects.toMatchObject({ status: 500, detail: 'plain text' })
  })

  it('applies a default timeout signal and none for timeoutMs 0', async () => {
    const { token } = await tokenFile('t')
    const signals: (AbortSignal | null | undefined)[] = []
    const fetchFn = (async (_u: unknown, init?: RequestInit) => { signals.push(init?.signal); return json(200, {}) }) as typeof fetch
    const rest = createHermesRest({ hermesUrl: 'http://h', token, fetch: fetchFn })
    await rest.request('GET', '/a')
    await rest.request('GET', '/b', { timeoutMs: 0 })
    expect(signals[0]).toBeInstanceOf(AbortSignal)
    expect(signals[1]).toBeUndefined()
  })

  it('returns undefined for an empty body', async () => {
    const { token } = await tokenFile('t')
    const { fetchFn } = scripted([new Response(null, { status: 204 })])
    expect(await createHermesRest({ hermesUrl: 'http://h', token, fetch: fetchFn }).request('DELETE', '/x')).toBeUndefined()
  })
})
