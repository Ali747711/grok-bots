import { createHash, randomBytes } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { signSession } from '../src/auth/session-cookie.js'
import { HermesToken } from '../src/hermes/token.js'
import { setLogSink } from '../src/log.js'
import { FakeUpstream } from './fake-upstream.js'
import { HOST, ORIGIN, makeDeps } from './helpers.js'

let upstream: FakeUpstream
let tokenFile: string
let app: ReturnType<typeof createApp>
let token: HermesToken
let upstreamHost: string
let cookies: string

const writeTokenFile = (value: string) => writeFile(tokenFile, value + '\n')

beforeEach(async () => {
  upstream = new FakeUpstream()
  const url = await upstream.start()
  upstreamHost = new URL(url).host
  tokenFile = join(await mkdtemp(join(tmpdir(), 'crew-tok-')), 'session-token')
  await writeTokenFile('tok-1')
  const base = makeDeps()
  token = new HermesToken(tokenFile)
  app = createApp({ ...base, config: { ...base.config, hermesUrl: url }, token, fetchUpstream: fetch })
  const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
  cookies = `crew_session=${session}; crew_csrf=c1`
})

afterEach(() => upstream.stop())

const proxied = (path: string, init: { method?: string; body?: Buffer; headers?: Record<string, string> } = {}) =>
  app.request(path, {
    method: init.method ?? 'GET',
    headers: {
      Host: HOST,
      Cookie: cookies,
      ...(init.method && init.method !== 'GET' ? { Origin: ORIGIN, 'X-Crew-CSRF': 'c1' } : {}),
      ...init.headers
    },
    ...(init.body ? { body: init.body, duplex: 'half' } : {})
  } as RequestInit)

describe('HermesToken', () => {
  it('reads the trimmed token and re-reads on refresh', async () => {
    expect(await token.get()).toBe('tok-1')
    await writeTokenFile('tok-2')
    expect(await token.get()).toBe('tok-1')
    expect(await token.refresh()).toBe('tok-2')
  })

  it('throws when the token file is missing', async () => {
    await expect(new HermesToken('/nonexistent/token').get()).rejects.toThrow()
  })
})

describe('REST proxy', () => {
  it('injects the Hermes token and strips browser credentials', async () => {
    const res = await proxied('/api/profiles', { headers: { Referer: 'http://127.0.0.1:7070/' } })
    expect(res.status).toBe(200)
    expect(upstream.last.headers['x-hermes-session-token']).toBe('tok-1')
    expect(upstream.last.headers.cookie).toBeUndefined()
    expect(upstream.last.headers.origin).toBeUndefined()
    expect(upstream.last.headers.referer).toBeUndefined()
    expect(upstream.last.headers.host).toBe(upstreamHost)
  })

  it('ignores a client-supplied Hermes token header', async () => {
    await proxied('/api/profiles', { headers: { 'X-Hermes-Session-Token': 'evil' } })
    expect(upstream.last.headers['x-hermes-session-token']).toBe('tok-1')
  })

  it('refuses non-allowlisted paths', async () => {
    for (const path of ['/api/env', '/api/pty', '/api/profilesX', '/api/config']) {
      const res = await proxied(path)
      expect(res.status).toBe(404)
      expect((await res.json()).error).toBe('not_proxied')
    }
    expect(upstream.calls).toBe(0)
  })

  it('requires a Crew session', async () => {
    const res = await app.request('/api/profiles', { headers: { Host: HOST } })
    expect(res.status).toBe(401)
    expect(upstream.calls).toBe(0)
  })

  it('re-reads the token once on 401, then succeeds', async () => {
    upstream.respondOnce(401)
    await writeTokenFile('tok-2')
    expect((await proxied('/api/profiles')).status).toBe(200)
    expect(upstream.last.headers['x-hermes-session-token']).toBe('tok-2')
    expect(token.state).toBe('ok')
  })

  it('401 twice → 503 hermes_signed_out', async () => {
    upstream.respondAlways(401)
    const res = await proxied('/api/profiles')
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('hermes_signed_out')
    expect(token.state).toBe('signed_out')
  })

  it('preserves query string and upstream status, drops unsafe response headers', async () => {
    upstream.respondOnce(201)
    const res = await proxied('/api/sessions?profile=x&limit=5')
    expect(upstream.last.url).toBe('/api/sessions?profile=x&limit=5')
    expect(res.status).toBe(201)
    expect(res.headers.get('content-type')).toMatch(/application\/json/)
    expect(res.headers.get('set-cookie')).toBeNull()
    expect(res.headers.get('x-internal')).toBeNull()
  })

  it('forwards a 5 MB body byte-identical', async () => {
    const body = randomBytes(5 * 1024 * 1024)
    const res = await proxied('/api/chat/file-upload', { method: 'POST', body, headers: { 'Content-Type': 'application/octet-stream' } })
    expect(res.status).toBe(200)
    expect(upstream.last.bodyBytes).toBe(body.length)
    expect(upstream.last.bodySha256).toBe(createHash('sha256').update(body).digest('hex'))
  })

  it('bodied request hitting 401 refreshes the token and answers 503 hermes_token_refreshed', async () => {
    upstream.respondOnce(401)
    await writeTokenFile('tok-3')
    const res = await proxied('/api/cron/jobs', { method: 'POST', body: Buffer.from('{}'), headers: { 'Content-Type': 'application/json' } })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('hermes_token_refreshed')
    expect(await token.get()).toBe('tok-3')
  })

  it('answers 502 when Hermes is unreachable', async () => {
    await upstream.stop()
    const res = await proxied('/api/profiles')
    expect(res.status).toBe(502)
    expect((await res.json()).error).toBe('hermes_unreachable')
  })

  it('logs never contain token', async () => {
    const lines: string[] = []
    const restore = setLogSink(line => lines.push(line))
    try {
      upstream.respondAlways(401)
      await proxied('/api/profiles')
      await upstream.stop()
      await proxied('/api/profiles')
    } finally {
      restore()
    }
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).not.toMatch(/tok-/)
  })
})
