import { chmod, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setLogSink } from '../src/log.js'
import { TriggerStore } from '../src/triggers/store.js'
import { jobNameFor, toView, type Trigger, type TriggerEvent } from '../src/triggers/types.js'

let dir: string
let file: string
let lines: string[]
let restore: () => void

const trigger = (over: Partial<Trigger> = {}): Trigger => ({
  id: 'a'.repeat(32), bot: 'crew-test', routineId: 'rt1', name: 'Pushes', source: 'github', events: ['push'], actions: [], enabled: true, secret: 's3cret', createdAt: 1, ...over
})
const event = (n: number, over: Partial<TriggerEvent> = {}): TriggerEvent => ({
  id: `e${n}`, at: n, deliveryId: null, eventType: 'push', action: null, outcome: 'bad_signature', jobId: null, runId: null, endedAt: null, detail: null, ...over
})

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'trig-'))
  file = join(dir, 'triggers.json')
  lines = []
  restore = setLogSink(l => { lines.push(l) })
})
afterEach(async () => {
  restore()
  await chmod(dir, 0o700).catch(() => undefined)
  await rm(dir, { recursive: true, force: true })
})

describe('TriggerStore', () => {
  it('starts empty without a file and writes 0600 with tmp + rename', async () => {
    const store = await TriggerStore.load(file)
    expect(store.all()).toEqual([])
    await store.add(trigger())
    expect((await stat(file)).mode & 0o777).toBe(0o600)
    expect(await readdir(dir)).toEqual(['triggers.json'])
  })

  it('round-trips triggers, events and deliveries through a reload', async () => {
    const store = await TriggerStore.load(file)
    await store.add(trigger())
    await store.logEvent('a'.repeat(32), event(1, { deliveryId: 'd1' }), 'd1')
    const again = await TriggerStore.load(file)
    expect(again.all()).toEqual([trigger()])
    expect(again.events('a'.repeat(32))).toEqual([event(1, { deliveryId: 'd1' })])
    expect(again.seenDelivery('a'.repeat(32), 'd1')).toBe(true)
  })

  it('moves a corrupt file aside and starts empty with one error line', async () => {
    await writeFile(file, '{nope')
    const store = await TriggerStore.load(file)
    expect(store.all()).toEqual([])
    expect((await readdir(dir)).some(f => /^triggers\.json\.corrupt-\d+$/.test(f))).toBe(true)
    expect(lines.filter(l => JSON.parse(l).level === 'error')).toHaveLength(1)
    await writeFile(file, JSON.stringify({ version: 2 }))
    await TriggerStore.load(file)
    expect((await readdir(dir)).filter(f => f.includes('corrupt'))).toHaveLength(2)
  })

  it('keeps the newest 50 events, newest first', async () => {
    const store = await TriggerStore.load(file)
    await store.add(trigger())
    for (let i = 1; i <= 60; i++) await store.logEvent('a'.repeat(32), event(i))
    const list = store.events('a'.repeat(32))
    expect(list).toHaveLength(50)
    expect(list[0]?.id).toBe('e60')
    expect(store.lastEvent('a'.repeat(32))?.id).toBe('e60')
  })

  it('never trims a started event out of the log', async () => {
    const store = await TriggerStore.load(file)
    await store.add(trigger())
    await store.logEvent('a'.repeat(32), event(0, { outcome: 'started' }))
    for (let i = 1; i <= 60; i++) await store.logEvent('a'.repeat(32), event(i))
    const list = store.events('a'.repeat(32))
    expect(list).toHaveLength(51)
    expect(list.some(e => e.id === 'e0')).toBe(true)
    expect(store.inFlight()).toHaveLength(1)
  })

  it('records delivery ids with an event and keeps the last 500', async () => {
    const store = await TriggerStore.load(file)
    await store.add(trigger())
    const id = 'a'.repeat(32)
    for (let i = 0; i <= 500; i++) await store.logEvent(id, event(i), `d${i}`)
    expect(store.seenDelivery(id, 'd0')).toBe(false)
    expect(store.seenDelivery(id, 'd500')).toBe(true)
    expect(store.seenDelivery(id, 'd1')).toBe(true)
    await store.recordDelivery(id, 'extra')
    expect(store.seenDelivery(id, 'extra')).toBe(true)
  })

  it('applies changes in memory at once and writes them in call order', async () => {
    const store = await TriggerStore.load(file)
    await store.add(trigger())
    const id = 'a'.repeat(32)
    const a = store.logEvent(id, event(1))
    const b = store.logEvent(id, event(2))
    expect(store.events(id).map(e => e.id)).toEqual(['e2', 'e1'])
    await Promise.all([a, b])
    expect((await TriggerStore.load(file)).events(id).map(e => e.id)).toEqual(['e2', 'e1'])
  })

  it('rejects the write promise when the file cannot be written, keeping memory', async () => {
    const store = await TriggerStore.load(file)
    await store.add(trigger())
    await chmod(dir, 0o500)
    await expect(store.logEvent('a'.repeat(32), event(1))).rejects.toThrow()
    expect(store.events('a'.repeat(32))).toHaveLength(1)
    await chmod(dir, 0o700)
    await store.recordDelivery('a'.repeat(32), 'd')
    expect((await TriggerStore.load(file)).events('a'.repeat(32))).toHaveLength(1)
  })

  it('patches an event and lists runs with a runId for one routine', async () => {
    const store = await TriggerStore.load(file)
    const id = 'a'.repeat(32)
    await store.add(trigger())
    await store.add(trigger({ id: 'b'.repeat(32), routineId: 'rt2', name: 'Other' }))
    await store.logEvent(id, event(1, { outcome: 'started' }))
    await store.logEvent(id, event(2))
    await store.logEvent('b'.repeat(32), event(3, { runId: 'r9' }))
    expect(store.runsFor('crew-test', 'rt1')).toEqual([])
    const patched = await store.patchEvent(id, 'e1', { outcome: 'finished', runId: 'r1', endedAt: 5 })
    expect(patched).toMatchObject({ id: 'e1', outcome: 'finished', runId: 'r1', endedAt: 5 })
    expect(await store.patchEvent(id, 'nope', {})).toBeUndefined()
    expect(store.runsFor('crew-test', 'rt1').map(r => [r.triggerId, r.triggerName, r.event.id])).toEqual([[id, 'Pushes', 'e1']])
    expect(store.inFlight()).toEqual([])
  })

  it('updates and removes a trigger with its events and deliveries', async () => {
    const store = await TriggerStore.load(file)
    const id = 'a'.repeat(32)
    await store.add(trigger())
    await store.logEvent(id, event(1), 'd1')
    expect((await store.update(id, { enabled: false, name: 'X' }))).toMatchObject({ enabled: false, name: 'X' })
    expect(await store.update('zz', {})).toBeUndefined()
    expect(store.forBot('crew-test')).toHaveLength(1)
    expect(await store.remove(id)).toBe(true)
    expect(await store.remove(id)).toBe(false)
    const again = await TriggerStore.load(file)
    expect(again.all()).toEqual([])
    expect(again.events(id)).toEqual([])
    expect(again.seenDelivery(id, 'd1')).toBe(false)
  })

  it('toView never includes the secret', () => {
    const view = toView(trigger(), 'http://x/hooks/a', null)
    expect(view).not.toHaveProperty('secret')
    expect(JSON.stringify(view)).not.toContain('s3cret')
    expect(view).toMatchObject({ url: 'http://x/hooks/a', lastEvent: null, name: 'Pushes' })
    expect(jobNameFor('a'.repeat(32), 'Daily', 'push')).toBe(`[trigger:${'a'.repeat(32)}] Daily · push`)
  })
})
