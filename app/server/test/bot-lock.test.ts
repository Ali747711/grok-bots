import { describe, expect, it } from 'vitest'

import { withBotLock } from '../src/bots/bot-lock.js'

const gate = () => {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

describe('withBotLock', () => {
  it('runs overlapping operations on one bot one after the other', async () => {
    const events: string[] = []
    const first = gate()
    const a = withBotLock('scout', async () => { events.push('a start'); await first.promise; events.push('a end'); return 'A' })
    const b = withBotLock('scout', async () => { events.push('b start'); return 'B' })
    await tick()
    expect(events).toEqual(['a start'])
    first.release()
    expect(await Promise.all([a, b])).toEqual(['A', 'B'])
    expect(events).toEqual(['a start', 'a end', 'b start'])
  })

  it('runs different bots concurrently', async () => {
    const hold = gate()
    const events: string[] = []
    const a = withBotLock('a', async () => { events.push('a start'); await hold.promise })
    const b = withBotLock('b', async () => { events.push('b start') })
    await b
    expect(events).toEqual(['a start', 'b start'])
    hold.release()
    await a
  })

  it('does not let a rejected run block the next one', async () => {
    const failed = withBotLock('scout', async () => { throw new Error('boom') })
    await expect(failed).rejects.toThrow('boom')
    await expect(withBotLock('scout', async () => 'ok')).resolves.toBe('ok')
  })

  it('forgets a bot once its queue drains', async () => {
    await withBotLock('scout', async () => undefined)
    await tick()
    const events: string[] = []
    await withBotLock('scout', async () => { events.push('ran') })
    expect(events).toEqual(['ran'])
  })
})
