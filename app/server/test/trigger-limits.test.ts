import { describe, expect, it } from 'vitest'

import { createLimiter, DEFAULT_LIMITS } from '../src/triggers/limits.js'

const setup = () => {
  let t = 1_000_000
  const limiter = createLimiter(DEFAULT_LIMITS, () => t)
  return { limiter, advance: (ms: number) => { t += ms } }
}

describe('limiter', () => {
  it('allows two in flight and refuses a third as concurrent', () => {
    const { limiter } = setup()
    expect(limiter.tryAcquire('a')).toEqual({ ok: true })
    expect(limiter.tryAcquire('a')).toEqual({ ok: true })
    expect(limiter.tryAcquire('a')).toEqual({ ok: false, reason: 'concurrent', detail: '2 runs already running' })
    limiter.release('a', true)
    expect(limiter.tryAcquire('a')).toEqual({ ok: true })
  })

  it('refuses the 11th run in an hour and allows it after the window', () => {
    const { limiter, advance } = setup()
    for (let i = 0; i < 10; i++) {
      expect(limiter.tryAcquire('a').ok).toBe(true)
      limiter.release('a', true)
    }
    expect(limiter.tryAcquire('a')).toEqual({ ok: false, reason: 'hourly', detail: '10 runs in the last hour' })
    advance(3_600_001)
    expect(limiter.tryAcquire('a')).toEqual({ ok: true })
  })

  it('gives the hourly slot back when no run happened', () => {
    const { limiter } = setup()
    for (let i = 0; i < 20; i++) {
      expect(limiter.tryAcquire('a').ok).toBe(true)
      limiter.release('a', false)
    }
  })

  it('checks the hour before concurrency', () => {
    const { limiter } = setup()
    limiter.seed('a', Array.from({ length: 10 }, (_, i) => 1_000_000 - i), 2)
    expect(limiter.tryAcquire('a')).toMatchObject({ reason: 'hourly' })
  })

  it('keeps triggers independent and honours seed', () => {
    const { limiter } = setup()
    limiter.seed('a', [999_000], 2)
    expect(limiter.tryAcquire('a')).toMatchObject({ ok: false, reason: 'concurrent' })
    expect(limiter.tryAcquire('b')).toEqual({ ok: true })
    limiter.seed('c', Array.from({ length: 10 }, () => 999_000), 0)
    expect(limiter.tryAcquire('c')).toMatchObject({ reason: 'hourly' })
  })
})
