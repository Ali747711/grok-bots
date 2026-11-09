import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { signSession } from '../src/auth/session-cookie.js'
import { PendingStore } from '../src/watcher/pending-store.js'
import { HOST, makeDeps } from './helpers.js'

const base = makeDeps()
const cookie = `crew_session=${signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })}`

function appWithWatcher() {
  const store = new PendingStore()
  store.add({ id: 'p-1', kind: 'approval', profile: 'crew-test', sessionId: 'r1', summary: 'rm -r /tmp/x', receivedAt: 1, source: 'snapshot_prompt' })
  const watcher = { store, debug: () => [{ at: 1, kind: 'subscribed' as const, detail: 'crew-test' }], stop: () => undefined }
  return createApp({ ...base, watcher })
}

describe('GET /crew/pending', () => {
  it('lists pending requests and debug entries for a logged-in user', async () => {
    const res = await appWithWatcher().request('/crew/pending', { headers: { Host: HOST, Cookie: cookie } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.pending.map((p: { id: string }) => p.id)).toEqual(['p-1'])
    expect(body.debug[0].kind).toBe('subscribed')
  })

  it('requires a Crew session', async () => {
    const res = await appWithWatcher().request('/crew/pending', { headers: { Host: HOST } })
    expect(res.status).toBe(401)
  })

  it('answers 503 when the watcher is not running', async () => {
    const res = await createApp(base).request('/crew/pending', { headers: { Host: HOST, Cookie: cookie } })
    expect(res.status).toBe(503)
  })
})
