import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { beforeAll, describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { signSession } from '../src/auth/session-cookie.js'
import { loadConfig } from '../src/config.js'
import { HOST, makeDeps } from './helpers.js'

const base = makeDeps()
const valid = `crew_session=${signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })}`

let app: ReturnType<typeof createApp>
let emptyApp: ReturnType<typeof createApp>

beforeAll(() => {
  const dist = mkdtempSync(join(tmpdir(), 'crew-spa-'))
  mkdirSync(join(dist, 'assets'))
  writeFileSync(join(dist, 'index.html'), '<div id=root></div>')
  writeFileSync(join(dist, 'assets', 'app.js'), 'console.log(1)')
  app = createApp({ ...base, config: { ...base.config, webDist: dist } })
  const missing = join(dist, 'nope')
  emptyApp = createApp({ ...base, config: { ...base.config, webDist: missing } })
})

function get(a: ReturnType<typeof createApp>, path: string, opts: { cookie?: string; accept?: string } = {}) {
  const headers: Record<string, string> = { Host: HOST }
  if (opts.cookie) headers.Cookie = opts.cookie
  if (opts.accept) headers.Accept = opts.accept
  return a.request(path, { headers })
}

describe('SPA serving', () => {
  it('serves index.html with CSP and nosniff to a logged-in user', async () => {
    const res = await get(app, '/', { cookie: valid })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('<div id=root>')
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'")
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('serves assets and falls back to index.html for client routes', async () => {
    const asset = await get(app, '/assets/app.js', { cookie: valid })
    expect(asset.status).toBe(200)
    expect(asset.headers.get('content-type')).toContain('javascript')
    expect(asset.headers.get('x-content-type-options')).toBe('nosniff')
    expect(asset.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    const route = await get(app, '/bots/default', { cookie: valid })
    expect(route.status).toBe(200)
    expect(await route.text()).toContain('<div id=root>')
  })

  it('redirects a browser navigation without a session to /login', async () => {
    const res = await get(app, '/bots/default', { accept: 'text/html' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/login')
  })

  it('keeps JSON 401 for /api and /crew without a session', async () => {
    for (const path of ['/crew/pending', '/api/sessions']) {
      const res = await get(app, path, { accept: 'text/html' })
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'login_required' })
    }
  })

  it('keeps JSON 401 for a non-HTML request without a session', async () => {
    const res = await get(app, '/assets/app.js', { accept: '*/*' })
    expect(res.status).toBe(401)
  })

  it('refuses path traversal out of webDist', async () => {
    for (const path of ['/..%2f..%2f..%2f..%2fetc%2fpasswd', '/%2e%2e/%2e%2e/etc/passwd', '/../../../../etc/passwd']) {
      const res = await get(app, path, { cookie: valid })
      const text = await res.text()
      expect(text).not.toContain('root:')
      expect([200, 404]).toContain(res.status)
      if (res.status === 200) expect(text).toContain('<div id=root>')
    }
  })

  it('does not serve unknown /api or /crew paths as the app', async () => {
    const res = await get(app, '/crew/nope', { cookie: valid })
    expect(res.status).toBe(404)
  })

  it('answers a minimal page when the web app is not built', async () => {
    const res = await get(emptyApp, '/', { cookie: valid })
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Crew web app not built yet')
  })
})

describe('loadConfig webDist', () => {
  it('defaults to app/web/dist and honours CREW_WEB_DIST', () => {
    expect(loadConfig({ HOME: '/h' }).webDist).toMatch(/app\/web\/dist$/)
    expect(loadConfig({ HOME: '/h', CREW_WEB_DIST: '~/x' }).webDist).toBe('/h/x')
  })
})
