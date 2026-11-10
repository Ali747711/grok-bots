import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { HermesRest } from '../src/hermes/rest-client.js'
import { TriggerStore } from '../src/triggers/store.js'
import type { Trigger, TriggerEvent } from '../src/triggers/types.js'
import { loadTriggerStore, wireTriggers } from '../src/triggers/wire.js'
import { createApp } from '../src/app.js'
import { HOST, makeDeps } from './helpers.js'
import { setLogSink } from '../src/log.js'
import type { RoutineService } from '../src/routines/service.js'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'wire-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 20 }) })

describe('wireTriggers', () => {
  it('has already resumed unfinished runs when it returns, so a first hook sees them counted', async () => {
    const store = await TriggerStore.load(join(dir, 'triggers.json'))
    const trigger: Trigger = { id: 'a'.repeat(32), bot: 'crew-test', routineId: 'rt1', name: 'T', source: 'generic', events: [], actions: [], enabled: true, secret: 's', createdAt: 1 }
    await store.add(trigger)
    const now = Date.now()
    for (const n of [1, 2]) {
      const e: TriggerEvent = { id: `o${n}`, at: now - 1000, deliveryId: null, eventType: 'e', action: null, outcome: 'started', jobId: `j${n}`, runId: null, endedAt: null, detail: null }
      await store.logEvent(trigger.id, e)
    }
    const rest: HermesRest = { request: async () => { throw new Error('offline') } }
    const { runner } = wireTriggers({ rest, store, now: Date.now, newId: () => 'id' })
    try {
      const r = await runner.start(trigger, { eventId: 'new', at: now, deliveryId: null, eventType: 'e', action: null, payload: { kind: 'text', text: '' } })
      expect(r).toMatchObject({ ok: false, status: 429, error: 'too_many_events', event: { detail: '2 runs already running' } })
    } finally { runner.stop() }
  })
})

describe('an unreadable triggers file', () => {
  it('isolates triggers: one error line, everything else keeps working, hooks and trigger routes answer 503', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => { lines.push(l) })
    try {
      const store = await loadTriggerStore(dir)
      expect(store).toBeNull()
      expect(lines.join('\n')).not.toMatch(/illegal operation|EISDIR:/)
      expect(lines.map(l => JSON.parse(l)).filter(l => l.level === 'error')).toEqual([expect.objectContaining({ file: dir, code: 'EISDIR' })])
      const routines = { list: async () => [] } as unknown as RoutineService
      const app = createApp({ ...makeDeps(), routines })
      expect((await app.request('/crew/health', { headers: { Host: HOST } })).status).toBe(200)
      const hook = await app.request(`/hooks/${'a'.repeat(32)}`, { method: 'POST', headers: { Host: HOST }, body: '{}' })
      expect(hook.status).toBe(503)
      expect(await hook.json()).toEqual({ error: 'triggers_unavailable' })
    } finally { restore() }
    expect(await loadTriggerStore(join(dir, 'fresh.json'))).not.toBeNull()
  })
})
