import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { signSession } from '../src/auth/session-cookie.js'
import type { CrewState } from '../src/watcher/bot-state.js'
import { PendingStore } from '../src/watcher/pending-store.js'
import { HOST, makeDeps } from './helpers.js'

const base = makeDeps()
const cookie = `crew_session=${signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })}`
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

type Asset = { found: boolean; mime?: string; data?: string }

function appWith(assets: Record<string, Asset>, hermes: CrewState['hermes'] = 'connected') {
  const calls: string[] = []
  const watcher = {
    store: new PendingStore(),
    debug: () => [],
    answer: () => 'sent' as const,
    onChange: () => () => undefined,
    state: (): CrewState => ({ hermes, bots: [], pending: [] }),
    getAvatar: async (name: string): Promise<Asset> => {
      calls.push(name)
      return assets[name] ?? { found: false }
    }
  }
  return { app: createApp({ ...base, watcher }), calls }
}

const get = (app: ReturnType<typeof createApp>, path: string, withCookie = true) =>
  app.request(path, { headers: { Host: HOST, ...(withCookie ? { Cookie: cookie } : {}) } })

describe('GET /crew/avatars/:name', () => {
  it('serves the avatar bytes with its image type and a private cache header', async () => {
    const { app } = appWith({ dev: { found: true, mime: 'image/png', data: `data:image/png;base64,${PNG_B64}` } })
    const res = await get(app, '/crew/avatars/dev')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('cache-control')).toBe('private, max-age=300')
    expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from(PNG_B64, 'base64'))
  })

  it('404s when the bot has no avatar', async () => {
    const { app } = appWith({})
    expect((await get(app, '/crew/avatars/dev')).status).toBe(404)
  })

  it('404s for a non-image type such as svg or html', async () => {
    const { app } = appWith({
      a: { found: true, data: `data:image/svg+xml;base64,${PNG_B64}` },
      b: { found: true, data: `data:text/html;base64,${PNG_B64}` }
    })
    expect((await get(app, '/crew/avatars/a')).status).toBe(404)
    expect((await get(app, '/crew/avatars/b')).status).toBe(404)
  })

  it('rejects invalid names without asking Hermes', async () => {
    const { app, calls } = appWith({})
    expect((await get(app, '/crew/avatars/..%2Fx')).status).toBe(404)
    expect((await get(app, '/crew/avatars/UPPER')).status).toBe(404)
    expect(calls).toEqual([])
  })

  it('answers 503 when Hermes is not connected', async () => {
    const { app } = appWith({}, 'offline')
    expect((await get(app, '/crew/avatars/dev')).status).toBe(503)
  })

  it('requires a Crew session', async () => {
    const { app } = appWith({})
    expect((await get(app, '/crew/avatars/dev', false)).status).toBe(401)
  })
})
