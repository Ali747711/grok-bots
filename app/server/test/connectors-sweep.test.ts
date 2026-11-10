import { describe, expect, it } from 'vitest'

import { SWEEP_GRACE_MS, createOrphanSweep } from '../src/connectors/sweep.js'

function setup(initial: string[] = ['a', 'ghost']) {
  const state = { bots: initial, now: 0, forgotten: [] as string[], gate: null as Promise<void> | null }
  const sweep = createOrphanSweep({
    bots: () => state.bots,
    forget: async b => { state.forgotten.push(b); if (state.gate) await state.gate },
    now: () => state.now
  })
  return { state, sweep }
}

describe('orphan sweep', () => {
  it('forgets a bot missing from two roster syncs at least 30 s apart', async () => {
    const { state, sweep } = setup()
    sweep.onRoster(['a'])
    await sweep.idle()
    expect(state.forgotten).toEqual([])
    state.now = SWEEP_GRACE_MS - 1
    sweep.onRoster(['a'])
    await sweep.idle()
    expect(state.forgotten).toEqual([])
    state.now = SWEEP_GRACE_MS
    sweep.onRoster(['a'])
    await sweep.idle()
    expect(state.forgotten).toEqual(['ghost'])
  })

  it('never sweeps on an empty roster or a bot that came back', async () => {
    const { state, sweep } = setup()
    sweep.onRoster(['a'])
    state.now = 100_000
    sweep.onRoster([])
    await sweep.idle()
    expect(state.forgotten).toEqual([])
    sweep.onRoster(['a', 'ghost'])
    state.now = 200_000
    sweep.onRoster(['a'])
    await sweep.idle()
    expect(state.forgotten).toEqual([])
  })

  it('forgets each orphan once even when syncs overlap', async () => {
    const { state, sweep } = setup()
    sweep.onRoster(['a'])
    state.now = 60_000
    let release!: () => void
    state.gate = new Promise<void>(r => { release = r })
    sweep.onRoster(['a'])
    sweep.onRoster(['a'])
    state.now = 120_000
    sweep.onRoster(['a'])
    release()
    await sweep.idle()
    sweep.onRoster(['a'])
    await sweep.idle()
    expect(state.forgotten).toEqual(['ghost'])
  })

  it('does not throw when forget rejects', async () => {
    const sweep = createOrphanSweep({ bots: () => ['ghost'], forget: async () => { throw new Error('x') }, now: () => 0 })
    sweep.onRoster(['a'])
    sweep.onRoster(['a'])
    await expect(sweep.idle()).resolves.toBeUndefined()
  })
})
