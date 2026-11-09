import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { HermesRest } from '../src/hermes/rest-client.js'
import { TriggerStore } from '../src/triggers/store.js'
import type { Trigger, TriggerEvent } from '../src/triggers/types.js'
import { wireTriggers } from '../src/triggers/wire.js'

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
