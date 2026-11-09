import { describe, expect, it } from 'vitest'

import { createLimiter, DEFAULT_LIMITS } from '../src/triggers/limits.js'

const T0 = 1_000_000
const setup = () => createLimiter(DEFAULT_LIMITS)
const must = (r: ReturnType<ReturnType<typeof createLimiter>['tryAcquire']>) => {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}`)
  return r
}

describe('limiter', () => {
  it('allows two in flight and refuses a third as concurrent', () => {
    const limiter = setup()
    const a = must(limiter.tryAcquire('a', T0))
    must(limiter.tryAcquire('a', T0))
    expect(limiter.tryAcquire('a', T0)).toEqual({ ok: false, reason: 'concurrent', detail: '2 runs already running' })
    a.release(true)
    expect(limiter.tryAcquire('a', T0).ok).toBe(true)
  })

  it('refuses the 11th run in an hour and allows it after the window', () => {
    const limiter = setup()
    for (let i = 0; i < 10; i++) must(limiter.tryAcquire('a', T0)).release(true)
    expect(limiter.tryAcquire('a', T0)).toEqual({ ok: false, reason: 'hourly', detail: '10 runs in the last hour' })
    expect(limiter.tryAcquire('a', T0 + 3_600_001).ok).toBe(true)
  })

  it('gives the hourly slot back when no run happened', () => {
    const limiter = setup()
    for (let i = 0; i < 20; i++) must(limiter.tryAcquire('a', T0)).release(false)
  })

  it('a second release does nothing: no extra slot, no extra stamp removed', () => {
    const limiter = setup()
    const a = must(limiter.tryAcquire('a', T0))
    must(limiter.tryAcquire('a', T0))
    a.release(true)
    a.release(true)
    a.release(false)
    expect(limiter.tryAcquire('a', T0).ok).toBe(true)
    expect(limiter.tryAcquire('a', T0)).toMatchObject({ reason: 'concurrent' })
  })

  it('a stray release after finished runs cannot let an 11th run through', () => {
    const limiter = setup()
    const handles = []
    for (let i = 0; i < 10; i++) {
      const h = must(limiter.tryAcquire('a', T0))
      h.release(true)
      handles.push(h)
    }
    handles[9]?.release(false)
    expect(limiter.tryAcquire('a', T0)).toMatchObject({ reason: 'hourly' })
  })

  it('release(false) removes only its own stamp, even when the older run fails', () => {
    const limiter = setup()
    const older = must(limiter.tryAcquire('a', T0))
    must(limiter.tryAcquire('a', T0 + 1000)).release(true)
    older.release(false)
    // 9 more fill the hour only if exactly one stamp (the older) was removed: 1 left + 9 = 10
    for (let i = 0; i < 9; i++) must(limiter.tryAcquire('a', T0 + 2000)).release(true)
    expect(limiter.tryAcquire('a', T0 + 2000)).toMatchObject({ reason: 'hourly' })
    // the surviving stamp is the newer one (T0+1000): had the newest been popped instead, the
    // T0 stamp would have expired by now and this would be allowed
    expect(limiter.tryAcquire('a', T0 + 3_600_500)).toMatchObject({ reason: 'hourly' })
  })

  it('adopt counts toward both caps and its release frees exactly one', () => {
    const limiter = setup()
    const adopted = limiter.adopt('a', T0 - 1000)
    must(limiter.tryAcquire('a', T0))
    expect(limiter.tryAcquire('a', T0)).toMatchObject({ reason: 'concurrent' })
    adopted.release(true)
    adopted.release(true)
    must(limiter.tryAcquire('a', T0))
    expect(limiter.tryAcquire('a', T0)).toMatchObject({ reason: 'concurrent' })
    const b = limiter.adopt('b', T0 - 10)
    b.release(false)
    for (let i = 0; i < 10; i++) must(limiter.tryAcquire('b', T0)).release(true)
    expect(limiter.tryAcquire('b', T0)).toMatchObject({ reason: 'hourly' })
  })

  it('keeps triggers independent', () => {
    const limiter = setup()
    must(limiter.tryAcquire('a', T0))
    must(limiter.tryAcquire('a', T0))
    expect(limiter.tryAcquire('a', T0).ok).toBe(false)
    expect(limiter.tryAcquire('b', T0).ok).toBe(true)
  })
})
