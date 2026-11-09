import { describe, expect, it } from 'vitest'

import { createApp } from '../src/app.js'
import { signSession } from '../src/auth/session-cookie.js'
import type { CrewState } from '../src/watcher/bot-state.js'
import { PendingStore } from '../src/watcher/pending-store.js'
import { HOST, makeDeps } from './helpers.js'

const base = makeDeps()
const cookie = `crew_session=${signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })}`

function fakeWatcher() {
  let current: CrewState = { hermes: 'connected', bots: [], pending: [] }
  const listeners = new Set<() => void>()
  return {
    store: new PendingStore(),
    debug: () => [],
    state: () => current,
    onChange: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } },
    listenerCount: () => listeners.size,
    set(next: CrewState) { current = next; for (const l of [...listeners]) l() }
  }
}

async function readEvent(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder()
  let text = ''
  while (!text.includes('\n\n')) {
    const { value, done } = await reader.read()
    if (done) break
    text += decoder.decode(value)
  }
  return text
}

const parse = (frame: string) => JSON.parse(frame.split('\n').find(l => l.startsWith('data:'))!.slice(5)) as CrewState

describe('state routes', () => {
  it('GET /crew/state returns the CrewState', async () => {
    const watcher = fakeWatcher()
    const res = await createApp({ ...base, watcher }).request('/crew/state', { headers: { Host: HOST, Cookie: cookie } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ hermes: 'connected', bots: [], pending: [] })
  })

  it('answers 503 without a watcher', async () => {
    const res = await createApp(base).request('/crew/state', { headers: { Host: HOST, Cookie: cookie } })
    expect(res.status).toBe(503)
  })

  it('requires a session for /crew/state and /crew/events', async () => {
    const app = createApp({ ...base, watcher: fakeWatcher() })
    for (const path of ['/crew/state', '/crew/events']) {
      const res = await app.request(path, { headers: { Host: HOST } })
      expect(res.status).toBe(401)
    }
  })

  it('broadcasts state to every SSE client and cleans up on disconnect', async () => {
    const watcher = fakeWatcher()
    const app = createApp({ ...base, watcher })
    const open = async () => {
      const controller = new AbortController()
      const res = await app.request('/crew/events', { headers: { Host: HOST, Cookie: cookie }, signal: controller.signal })
      expect(res.headers.get('content-type')).toContain('text/event-stream')
      return { reader: res.body!.getReader(), controller }
    }
    const a = await open()
    const b = await open()
    for (const c of [a, b]) {
      const first = await readEvent(c.reader)
      expect(first).toContain('event: state')
      expect(parse(first).hermes).toBe('connected')
    }
    watcher.set({ hermes: 'offline', bots: [], pending: [] })
    for (const c of [a, b]) expect(parse(await readEvent(c.reader)).hermes).toBe('offline')
    expect(watcher.listenerCount()).toBe(2)
    a.controller.abort(); b.controller.abort()
    await a.reader.cancel().catch(() => undefined)
    await b.reader.cancel().catch(() => undefined)
    await new Promise(r => setTimeout(r, 20))
    expect(watcher.listenerCount()).toBe(0)
  })
})
