import { describe, expect, it } from 'vitest'

import { createReconnector } from '../src/connectors/reconnect.js'
import { setLogSink } from '../src/log.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

function setup(wanted: (bot: string) => boolean = () => true) {
  const rpc = new FakeRpc()
  const rest = new FakeRest()
  const events: string[] = []
  rpc.handlers.set('reload.mcp', p => { events.push(`reload${p.session_id ? ':chat' : ''}`); return {} })
  rpc.handlers.set('profiles.list', () => ({ profiles: [{ name: 'scout', canonical_session: { id: 'c1' } }] }))
  rest.routes.set('PUT /api/mcp/servers/crew_apps/enabled', r => {
    events.push(`enabled:${(r.body as { enabled: boolean }).enabled}`)
    return { ok: true }
  })
  const gate: { release: () => void; sleeps: number[] } = { release: () => undefined, sleeps: [] }
  const sleep = (ms: number) => { gate.sleeps.push(ms); events.push('sleep'); return new Promise<void>(r => { gate.release = r }) }
  const reconnector = createReconnector({
    hermes: { rpc: rpc.call, rest: rest as never }, wanted, sleep, recipe: { gapMs: 1234, nudge: true }
  })
  return { reconnector, events, gate }
}
const tick = () => new Promise(r => setTimeout(r, 5))

describe('reconnector', () => {
  it('disables, nudges, waits the gap, enables and nudges with the chat', async () => {
    const { reconnector, events, gate } = setup()
    reconnector.schedule('scout')
    await tick()
    gate.release()
    await reconnector.idle('scout')
    expect(events).toEqual(['enabled:false', 'reload', 'sleep', 'enabled:true', 'reload:chat'])
    expect(gate.sleeps).toEqual([1234])
  })

  it('coalesces schedules before the enable step and runs once more after it', async () => {
    const { reconnector, events, gate } = setup()
    reconnector.schedule('scout')
    reconnector.schedule('scout')
    await tick()
    reconnector.schedule('scout')
    gate.release()
    await tick()
    // Past the enable step now: one more run is queued, however many schedules arrive.
    reconnector.schedule('scout')
    reconnector.schedule('scout')
    await tick()
    gate.release()
    await reconnector.idle('scout')
    expect(events.filter(e => e === 'enabled:false')).toHaveLength(2)
    expect(events.filter(e => e === 'enabled:true')).toHaveLength(2)
  })

  it('skips the enable when the bot no longer wants apps', async () => {
    let want = true
    const { reconnector, events, gate } = setup(() => want)
    reconnector.schedule('scout')
    await tick()
    want = false
    gate.release()
    await reconnector.idle('scout')
    expect(events).toEqual(['enabled:false', 'reload', 'sleep'])
  })

  it('logs a failed step and never rejects', async () => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    const failing = createReconnector({
      hermes: { rpc: async () => { throw new Error('down ak_test_key_123') }, rest: { request: async () => { throw new Error('nope') } } as never },
      wanted: () => true, sleep: async () => undefined, recipe: { gapMs: 1, nudge: true }
    })
    failing.schedule('scout')
    await expect(failing.idle('scout')).resolves.toBeUndefined()
    restore()
    const steps = lines.map(l => JSON.parse(l)).filter(l => l.bot === 'scout' && l.step).map(l => l.step)
    expect(steps).toEqual(['disable', 'enable'])
    expect(lines.join('')).not.toContain('ak_test_key_123')
  })
})
