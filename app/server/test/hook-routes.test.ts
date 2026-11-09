import { describe, expect, it } from 'vitest'

import { setLogSink } from '../src/log.js'

import { createApp } from '../src/app.js'
import { MAX_HOOK_BYTES, type HookHandler } from '../src/triggers/hook-handler.js'
import { readLimited } from '../src/http/hook-routes.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const seen: { id: string; raw: Buffer | null; sig: string | null }[] = []
const fake: HookHandler = {
  handle: async (id, raw, headers) => {
    seen.push({ id, raw, sig: headers.get('x-hub-signature-256') })
    return { status: 202, body: { status: 'accepted', event: 'issues', eventId: 'e1' }, event: null }
  }
}
const app = createApp({ ...makeDeps(), triggers: { hooks: fake } })
const post = (path: string, init: RequestInit = {}, host = HOST) => app.request(path, { method: 'POST', ...init, headers: { Host: host, ...(init.headers as Record<string, string> | undefined) } })

describe('POST /hooks/:id', () => {
  it('reaches the handler with no cookie, Origin or CSRF header', async () => {
    seen.length = 0
    const res = await post(`/hooks/${'a'.repeat(32)}`, { body: '{"a":1}', headers: { 'X-Hub-Signature-256': 'sha256=ff' } })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ status: 'accepted', event: 'issues', eventId: 'e1' })
    expect(seen[0]).toMatchObject({ id: 'a'.repeat(32), sig: 'sha256=ff' })
    expect(seen[0]?.raw?.toString()).toBe('{"a":1}')
    const bad = await post('/hooks/not-an-id', { body: 'x' })
    expect(bad.status).toBe(202)
    expect(seen.at(-1)?.id).toBe('not-an-id')
  })

  it('still applies the host guard', async () => {
    const res = await post(`/hooks/${'a'.repeat(32)}`, { body: '{}' }, 'evil.example:7070')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad_host' })
  })

  it('keeps GET /hooks/<id>, POST /hooks/<id>/x, POST /hooks/ and /crew/* behind the session', async () => {
    const get = await app.request(`/hooks/${'a'.repeat(32)}`, { headers: { Host: HOST } })
    expect(get.status).toBe(401)
    // Not exempt: without the CSRF pair the origin guard answers 403; with it (and no session) the session guard answers 401.
    const csrf = { Origin: ORIGIN, Cookie: 'crew_csrf=tok', 'X-Crew-CSRF': 'tok' }
    for (const path of [`/hooks/${'a'.repeat(32)}/x`, '/hooks/', `/hooks/${'a'.repeat(32)}/`]) {
      expect((await post(path, { body: '{}', headers: { Origin: ORIGIN } })).status).toBe(403)
      expect((await post(path, { body: '{}', headers: csrf })).status).toBe(401)
    }
    expect((await post('/crew/whoami', { body: '{}' })).status).toBe(403)
    expect((await post('/crew/groups', { body: '{}', headers: { Origin: ORIGIN } })).status).toBe(403)
  })

  it('answers 503 when triggers are not wired', async () => {
    const bare = createApp(makeDeps())
    const res = await bare.request(`/hooks/${'a'.repeat(32)}`, { method: 'POST', headers: { Host: HOST }, body: '{}' })
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'triggers_unavailable' })
  })

  it('passes null to the handler above 1 MiB and the bytes at exactly 1 MiB', async () => {
    seen.length = 0
    const big = Buffer.alloc(MAX_HOOK_BYTES + 1, 97)
    await post(`/hooks/${'a'.repeat(32)}`, { body: big })
    expect(seen[0]?.raw).toBeNull()
    await post(`/hooks/${'a'.repeat(32)}`, { body: big.subarray(0, MAX_HOOK_BYTES) })
    expect(seen[1]?.raw?.length).toBe(MAX_HOOK_BYTES)
  })
})

describe('errors and 413', () => {
  const id = 'a'.repeat(32)
  it('answers 500 JSON and logs one error line when the handler throws', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => { lines.push(l) })
    const boom = createApp({ ...makeDeps(), triggers: { hooks: { handle: async () => { throw new Error('secret=abc exploded') } } } })
    try {
      const res = await boom.request(`/hooks/${id}`, { method: 'POST', headers: { Host: HOST }, body: '{}' })
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: 'internal' })
    } finally { restore() }
    const out = lines.map(l => JSON.parse(l)).filter(l => l.msg === 'hook event')
    expect(out).toEqual([expect.objectContaining({ level: 'info', trigger: 'aaaaaaaa', outcome: 'error', status: 500 })])
    expect(lines.join('\n')).not.toContain('secret=abc')
  })

  it('closes the connection on a 413', async () => {
    const tooBig = createApp({ ...makeDeps(), triggers: { hooks: { handle: async () => ({ status: 413, body: { error: 'too_large' }, event: null }) } } })
    const res = await tooBig.request(`/hooks/${id}`, { method: 'POST', headers: { Host: HOST }, body: '{}' })
    expect(res.status).toBe(413)
    expect(res.headers.get('connection')).toBe('close')
  })
})

describe('readLimited', () => {
  it('rejects by Content-Length and by streamed size, and stops reading at the cap', async () => {
    const byLength = new Request('http://x/h', { method: 'POST', body: 'ab', headers: { 'content-length': String(MAX_HOOK_BYTES + 1) } })
    expect(await readLimited(byLength, MAX_HOOK_BYTES)).toBeNull()
    let pulled = 0
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(400_000))
        if (pulled > 50) controller.close()
      }
    })
    const streamed = new Request('http://x/h', { method: 'POST', body: stream, duplex: 'half' } as RequestInit)
    expect(await readLimited(streamed, MAX_HOOK_BYTES)).toBeNull()
    expect(pulled).toBeLessThan(10)
    expect((await readLimited(new Request('http://x/h', { method: 'POST', body: Buffer.alloc(MAX_HOOK_BYTES, 1) }), MAX_HOOK_BYTES))?.length).toBe(MAX_HOOK_BYTES)
    expect((await readLimited(new Request('http://x/h', { method: 'POST' }), 10))?.length).toBe(0)
  })
})
