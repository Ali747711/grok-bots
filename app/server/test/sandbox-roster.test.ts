import { describe, expect, it } from 'vitest'

import { createSandboxRoster } from '../src/bots/sandbox-roster.js'

const ON = { terminal: { backend: 'docker' }, agent: { disabled_toolsets: ['browser'] } }

describe('createSandboxRoster', () => {
  it('reads each bot once per 60 s and again after invalidate', async () => {
    let clock = 0
    const reads: string[] = []
    const roster = createSandboxRoster(async name => { reads.push(name); return ON }, () => clock)
    expect((await roster.states(['a', 'b'])).get('a')).toBe('on')
    await roster.states(['a', 'b'])
    expect(reads).toEqual(['a', 'b'])
    clock = 59_999
    await roster.states(['a'])
    expect(reads).toHaveLength(2)
    roster.invalidate('a')
    await roster.states(['a', 'b'])
    expect(reads).toEqual(['a', 'b', 'a'])
    clock = 60_000
    await roster.states(['a', 'b'])
    expect(reads).toEqual(['a', 'b', 'a', 'b'])
  })

  it('reads stale names in parallel', async () => {
    let inFlight = 0
    let peak = 0
    const roster = createSandboxRoster(async () => {
      inFlight += 1
      peak = Math.max(peak, inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight -= 1
      return {}
    }, () => 0)
    await roster.states(['a', 'b', 'c'])
    expect(peak).toBe(3)
  })

  it('keeps the last state when a read fails and never rejects', async () => {
    let clock = 0
    let fail = false
    const roster = createSandboxRoster(async () => { if (fail) throw new Error('boom'); return ON }, () => clock)
    expect((await roster.states(['a'])).get('a')).toBe('on')
    fail = true
    clock = 70_000
    expect((await roster.states(['a', 'never'])).get('a')).toBe('on')
    expect((await roster.states(['never'])).has('never')).toBe(false)
  })
})
