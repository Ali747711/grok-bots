import { describe, expect, it } from 'vitest'

import type { BotDeps } from '../src/bots/create.js'
import { gatherFacts, type FactsDeps } from '../src/voice/facts.js'
import type { BotView } from '../src/watcher/bot-state.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

const bot = (over: Partial<BotView>): BotView =>
  ({ name: 'x', title: 'X', role: null, job: '', hidden: false, isPrimary: false, sandbox: 'off', ...over }) as unknown as BotView

function deps(over: Partial<FactsDeps> = {}): { deps: FactsDeps; rest: FakeRest } {
  const rest = new FakeRest()
  rest.routes.set('GET /api/tools/toolsets', () => [
    { name: 'memory', enabled: true, configured: true, platform: 'cli' },
    { name: 'computer_use', enabled: false, configured: true, platform: 'cli' }
  ])
  rest.configs.set('scout', { terminal: { backend: 'docker' } })
  const bots = { rest: { request: rest.request } } as unknown as BotDeps
  return {
    rest,
    deps: {
      bots,
      hermesHome: '/h',
      owner: () => ({ name: 'Ali', timeZone: 'Asia/Seoul' }),
      roster: () => [
        bot({ name: 'scout', title: 'Scout', role: 'researcher' as never, job: 'Find papers' }),
        bot({ name: 'bella', title: 'Bella', job: 'Inbox' }),
        bot({ name: 'ghost', title: 'Ghost', hidden: true })
      ],
      groups: () => ({ available: true, seatable: [], rooms: [
        { id: 'r1', name: 'Ops', purpose: 'Ship it', members: [{ memberId: 'a', profile: 'scout', handle: 'scout', displayName: null }] },
        { id: 'r2', name: 'Other', purpose: '', members: [{ memberId: 'b', profile: 'bella', handle: 'bella', displayName: null }] }
      ] as never }),
      apps: () => [{ name: 'GitHub', level: 'change' }],
      routines: async () => [
        { title: 'Digest', schedule: { kind: 'daily', time: '09:00' }, enabled: true, finished: false, triggerOnly: false },
        { title: 'Done', schedule: { kind: 'daily', time: '09:00' }, enabled: false, finished: true, triggerOnly: false },
        { title: 'On push', schedule: { kind: 'every', amount: 1, unit: 'h' }, enabled: false, finished: false, triggerOnly: true }
      ] as never,
      ...over
    }
  }
}

describe('gatherFacts', () => {
  it("lists visible teammates, the bot's groups, unfinished routines and its apps", async () => {
    const facts = await gatherFacts(deps().deps, 'scout')
    expect(facts.owner).toEqual({ name: 'Ali', timeZone: 'Asia/Seoul' })
    expect(facts.self).toEqual({ title: 'Scout', handle: 'scout', role: 'researcher', job: 'Find papers' })
    expect(facts.computer).toEqual({ on: false, sandboxed: true })
    expect(facts.memory).toEqual({ on: true, worklog: '/workspace/worklog.md' })
    expect(facts.teammates).toEqual([{ title: 'Bella', handle: 'bella', role: null, job: 'Inbox' }])
    expect(facts.groups).toEqual([{ name: 'Ops', purpose: 'Ship it' }])
    expect(facts.routines).toEqual([
      { title: 'Digest', when: 'Every day at 09:00', state: 'on' },
      { title: 'On push', when: 'Every hour', state: 'triggered' }
    ])
    expect(facts.apps).toEqual([{ name: 'GitHub', level: 'change' }])
  })

  it('gives the primary its handle and a local work log under the Hermes home', async () => {
    const d = deps({ roster: () => [bot({ name: 'default', title: 'Hermes', isPrimary: true })] })
    d.rest.configs.set('default', {})
    const facts = await gatherFacts(d.deps, 'default')
    expect(facts.self.handle).toBe('hermes')
    expect(facts.memory.worklog).toBe('/h/worklog.md')
  })

  it('reads the title and job from Hermes when the roster does not list the new bot yet', async () => {
    const d = deps({ roster: () => [] })
    const rpc = new FakeRpc()
    rpc.meta('scout', { title: 'Scout' }, 1)
    rpc.rows.get('scout')!.description = 'Find papers'
    ;(d.deps.bots as { rpc: unknown }).rpc = rpc.call
    d.rest.soul('scout', '')
    const facts = await gatherFacts(d.deps, 'scout')
    expect(facts.self).toMatchObject({ title: 'Scout', job: 'Find papers' })
  })

  it('reports no apps when the Composio key is missing', async () => {
    const facts = await gatherFacts(deps({ apps: () => [] }).deps, 'scout')
    expect(facts.apps).toEqual([])
  })
})
