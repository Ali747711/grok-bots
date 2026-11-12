import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLogSink } from '../src/log.js'
import { createScheduler, rosterFingerprint } from '../src/voice/scheduler.js'
import type { BotView } from '../src/watcher/bot-state.js'

const inScope = (bot: string) => /^e2e\d+$/.test(bot)
let runs: string[]
let lines: string[]
let restore: () => void

beforeEach(() => {
  vi.useFakeTimers()
  runs = []
  lines = []
  restore = setLogSink(l => lines.push(l))
})
afterEach(() => {
  restore()
  vi.useRealTimers()
})

const make = (over: Partial<Parameters<typeof createScheduler>[0]> = {}) => createScheduler({
  delayMs: 3000, sweepMs: 600_000, names: () => ['default', 'bella', 'e2e1', 'e2e2'], inScope: () => true,
  run: async bot => { runs.push(bot) }, ...over
})

describe('createScheduler', () => {
  it('debounces many changes into one run per bot after 3 s', async () => {
    const s = make()
    s.schedule('e2e1'); s.schedule('e2e1'); s.schedule('e2e2')
    await vi.advanceTimersByTimeAsync(2999)
    expect(runs).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(runs).toEqual(['e2e1', 'e2e2'])
    s.stop()
  })

  it('runs only in-scope bots in e2e scope', async () => {
    const s = make({ names: () => ['default', 'bella', 'e2e1'], inScope })
    s.schedule()
    s.schedule('bella')
    await vi.advanceTimersByTimeAsync(3000)
    expect(runs).toEqual(['e2e1'])
    s.stop()
  })

  it('a failed run is logged and the bot runs again on the next trigger', async () => {
    let fail = true
    const s = make({ run: async bot => { runs.push(bot); if (fail) throw new Error('boom') } })
    s.schedule('e2e1')
    await vi.advanceTimersByTimeAsync(3000)
    expect(lines.some(l => JSON.parse(l).msg === 'right-now write failed' && JSON.parse(l).bot === 'e2e1')).toBe(true)
    fail = false
    s.schedule('e2e1')
    await vi.advanceTimersByTimeAsync(3000)
    expect(runs).toEqual(['e2e1', 'e2e1'])
    s.stop()
  })

  it('does not flush before beforeFirstPass resolves', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>(resolve => { release = resolve })
    const s = make({ beforeFirstPass: () => gate })
    s.schedule('e2e1')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(runs).toEqual([])
    release()
    await vi.advanceTimersByTimeAsync(3000)
    expect(runs).toEqual(['e2e1'])
    s.stop()
  })

  it('sweeps every in-scope bot on the sweep interval', async () => {
    const s = make({ inScope })
    await vi.advanceTimersByTimeAsync(600_000 + 3000)
    expect(runs).toEqual(['e2e1', 'e2e2'])
    s.stop()
  })
})

describe('rosterFingerprint', () => {
  const bot = (over: Partial<BotView>): BotView =>
    ({ name: 'e2e1', title: 'A', role: null, job: '', hidden: false, isPrimary: false, sandbox: 'off', status: 'idle', ...over }) as unknown as BotView
  const groups = { available: true, seatable: [], rooms: [] }

  it('a title change in the roster schedules everyone; a status change does not', () => {
    const base = rosterFingerprint([bot({})], groups)
    expect(rosterFingerprint([bot({ status: 'working' } as Partial<BotView>)], groups)).toBe(base)
    expect(rosterFingerprint([bot({ title: 'B' })], groups)).not.toBe(base)
    const room = { id: 'r', name: 'Ops', purpose: 'p', members: [{ memberId: 'm', profile: 'e2e1', handle: 'e2e1', displayName: null }] }
    expect(rosterFingerprint([bot({})], { ...groups, rooms: [room as never] })).not.toBe(base)
  })
})
