import { describe, expect, it } from 'vitest'

import { createDialBudget } from '@/features/computer/dial-budget'

function make() {
  let t = 1000
  const budget = createDialBudget({ max: 3, windowMs: 10_000, mountDelayMs: 300, now: () => t })
  return { budget, advance: (ms: number) => { t += ms } }
}

describe('dial budget', () => {
  it('limits dials to three per bot per ten seconds and waits 300 ms after mount', () => {
    const { budget, advance } = make()
    budget.markMounted('scout')
    expect(budget.request('scout')).toEqual({ allowed: false, reason: 'mounting', retryInMs: 300 })
    advance(299)
    expect(budget.request('scout')).toMatchObject({ allowed: false, reason: 'mounting', retryInMs: 1 })
    advance(1)
    expect(budget.request('scout')).toEqual({ allowed: true })
    advance(100)
    expect(budget.request('scout')).toEqual({ allowed: true })
    expect(budget.request('scout')).toEqual({ allowed: true })
    expect(budget.request('scout')).toMatchObject({ allowed: false, reason: 'exhausted' })
    // Another bot has its own budget.
    budget.markMounted('reese')
    advance(300)
    expect(budget.request('reese')).toEqual({ allowed: true })
    // The first dial leaves the window 10 s after it was made.
    advance(9_600)
    expect(budget.request('scout')).toEqual({ allowed: true })
  })

  it('manual reset gives a fresh budget and a refused dial is not counted', () => {
    const { budget, advance } = make()
    budget.markMounted('scout')
    advance(300)
    for (let i = 0; i < 3; i++) budget.request('scout')
    expect(budget.request('scout').allowed).toBe(false)
    budget.reset('scout')
    expect(budget.request('scout')).toEqual({ allowed: true })
  })
})
