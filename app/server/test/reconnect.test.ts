import { describe, expect, it } from 'vitest'

import { withBotLock } from '../src/bots/bot-lock.js'
import { createReconnector } from '../src/connectors/reconnect.js'
import { setLogSink } from '../src/log.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

function setup(wanted: (bot: string) => boolean = () => true) {
  const rpc = new FakeRpc()
  const rest = new FakeRest()
  const events: string[] = []
  rpc.handlers.set('reload.mcp', p => { events.push(`reload${p.session_id ? ':chat' : ''}`); return {} })
  rpc.handlers.set('profiles.list', () => ({ profiles: [{ name: 'scout', canonical_session: { id: 'c1' } }] }))
  const hold: { enable: Promise<void> | null } = { enable: null }
  rest.routes.set('PUT /api/mcp/servers/crew_apps/enabled', async r => {
    const enabled = (r.body as { enabled: boolean }).enabled
    events.push(`enabled:${enabled}`)
    if (enabled && hold.enable) await hold.enable
    return { ok: true }
  })
  const gate: { release: () => void; sleeps: number[] } = { release: () => undefined, sleeps: [] }
  const sleep = (ms: number) => { gate.sleeps.push(ms); events.push('sleep'); return new Promise<void>(r => { gate.release = r }) }
  const reconnector = createReconnector({
    hermes: { rpc: rpc.call, rest: rest as never }, wanted, sleep, recipe: { gapMs: 1234, nudge: true }
  })
  return { reconnector, events, gate, hold }
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
    const { reconnector, events, gate, hold } = setup()
    let open: () => void = () => undefined
    hold.enable = new Promise<void>(r => { open = r })
    reconnector.schedule('scout')
    reconnector.schedule('scout')
    await tick()
    gate.release()
    await tick()
    // The enable PUT is held: the run is past its enable step, so these queue exactly one more run.
    reconnector.schedule('scout')
    reconnector.schedule('scout')
    let idle = false
    void reconnector.idle('scout').then(() => { idle = true })
    hold.enable = null
    open()
    await tick()
    expect(events.filter(e => e === 'enabled:false')).toHaveLength(2)
    expect(idle).toBe(false)
    gate.release()
    await reconnector.idle('scout')
    expect(idle).toBe(true)
    expect(events.filter(e => e === 'enabled:false')).toHaveLength(2)
    expect(events.filter(e => e === 'enabled:true')).toHaveLength(2)
  })

  it('does not enable after a turn-off that holds the lock while the enable waits', async () => {
    let want = true
    const { reconnector, events, gate } = setup(() => want)
    reconnector.schedule('scout')
    await tick()
    let release: () => void = () => undefined
    const turnOff = withBotLock('scout', async () => {
      await new Promise<void>(r => { release = r })
      want = false
    })
    gate.release()
    await tick()
    release()
    await turnOff
    await reconnector.idle('scout')
    expect(events).toEqual(['enabled:false', 'reload', 'sleep'])
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

  it('reports through settled whether the disable and enable steps went through', async () => {
    const good = setup()
    expect(await good.reconnector.settled('scout')).toBe(true)
    good.reconnector.schedule('scout')
    const settled = good.reconnector.settled('scout')
    await tick()
    good.gate.release()
    expect(await settled).toBe(true)
    const unwanted = setup(() => false)
    unwanted.reconnector.schedule('scout')
    const paused = unwanted.reconnector.settled('scout')
    await tick()
    unwanted.gate.release()
    expect(await paused).toBe(true)
    const restore = setLogSink(() => undefined)
    const failing = createReconnector({
      hermes: { rpc: async () => ({}), rest: { request: async () => { throw new Error('nope') } } as never },
      wanted: () => true, sleep: async () => undefined, recipe: { gapMs: 1, nudge: false }
    })
    failing.schedule('scout')
    expect(await failing.settled('scout')).toBe(false)
    restore()
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
