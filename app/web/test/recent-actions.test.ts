import { describe, expect, it } from 'vitest'

import type { ChatItem, WorkStep } from '@/chat/types'
import { formatClock, nowStep, recentActions } from '@/features/side-panel/recent-actions'

const step = (id: string, over: Partial<WorkStep> = {}): WorkStep => ({ id, name: 'terminal', summary: `run ${id}`, running: false, ...over })
const work = (id: string, steps: WorkStep[]): ChatItem => ({ kind: 'work', id, steps })

describe('recentActions', () => {
  it('lists tool steps newest first, at most 50, with failed marks', () => {
    const items: ChatItem[] = [
      { kind: 'user', id: 'u1', text: 'go' },
      work('w1', [step('a', { at: 1000 }), step('b', { isError: true, name: 'browser_navigate', summary: 'example.com' })]),
      { kind: 'assistant', id: 'a1', text: 'done' },
      work('w2', [step('c', { running: true, at: 3000 })])
    ]
    expect(recentActions(items)).toEqual([
      { id: 'w2:c', name: 'terminal', summary: 'run c', failed: false, at: 3000 },
      { id: 'w1:b', name: 'browser_navigate', summary: 'example.com', failed: true, at: null },
      { id: 'w1:a', name: 'terminal', summary: 'run a', failed: false, at: 1000 }
    ])

    const many = [work('big', Array.from({ length: 60 }, (_, i) => step(`s${i}`)))]
    const listed = recentActions(many)
    expect(listed).toHaveLength(50)
    expect(listed[0]!.id).toBe('big:s59')
    expect(listed.at(-1)!.id).toBe('big:s10')
    expect(recentActions(many, 3).map(a => a.id)).toEqual(['big:s59', 'big:s58', 'big:s57'])
    expect(recentActions([])).toEqual([])
  })

  it('keeps ids unique when two turns reuse a step id', () => {
    const ids = recentActions([work('w1', [step('x')]), work('w2', [step('x')])]).map(a => a.id)
    expect(new Set(ids).size).toBe(2)
  })

  it('formats HH:MM and leaves the time blank without one', () => {
    expect(formatClock(new Date(2026, 0, 5, 9, 7, 59).getTime())).toBe('09:07')
    expect(formatClock(new Date(2026, 0, 5, 0, 0).getTime())).toBe('00:00')
    expect(formatClock(new Date(2026, 0, 5, 23, 45).getTime())).toBe('23:45')
    // A step with no time has `at: null`; the row shows nothing for it.
    expect(recentActions([work('w', [step('a')])])[0]!.at).toBeNull()
  })

  it('nowStep is the running step of the last turn, else null', () => {
    const running = step('r', { running: true, summary: 'Opening the page' })
    expect(nowStep([])).toBeNull()
    expect(nowStep([work('w1', [step('a')])])).toBeNull()
    expect(nowStep([work('w1', [step('a'), running])])).toEqual(running)
    // The newest running step when two run at once.
    const second = step('r2', { running: true })
    expect(nowStep([work('w1', [running, second])])).toEqual(second)
    // Only the last turn counts: an older block's step is not "now".
    expect(nowStep([work('w1', [running]), { kind: 'user', id: 'u', text: 'next' }, work('w2', [step('b')])])).toBeNull()
    expect(nowStep([work('w1', [running]), { kind: 'assistant', id: 'a', text: 'still going' }])).toEqual(running)
  })
})
