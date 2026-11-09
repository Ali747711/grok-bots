import { describe, expect, it, vi } from 'vitest'

import type { GroupRpc } from '../src/groups/group-rpc.js'
import type { GroupWatcher } from '../src/groups/group-watcher.js'
import type { GroupView, GroupsState, HermesPendingAction } from '../src/groups/types.js'
import { composeCrewState } from '../src/state/crew-state.js'
import type { BotView, WatcherState } from '../src/watcher/bot-state.js'
import { PendingStore } from '../src/watcher/pending-store.js'
import type { Watcher } from '../src/watcher/watcher.js'

const bot = (name: string, status: BotView['status'] = 'idle'): BotView => ({
  name, title: name, color: null, shape: null, isPrimary: false, hasAvatar: false, avatar: null, imageKind: null, model: null,
  sessionId: null, preview: null, lastActive: null, status, hidden: false, setupIncomplete: false, created: null
})
const room = (activity: GroupView['activity']): GroupView => ({
  id: 'r1', name: 'N', members: [], routing: 'everyone', leadMemberId: null, purpose: '', notes: '', latestSeq: 0, epoch: 1, updatedAt: 1,
  working: true, activity, turnActions: [], maxContinues: 5, maxRounds: 3, preview: null
})
const action: HermesPendingAction = {
  kind: 'approval', member_id: 'crew-test', task_id: 't1', execution_generation: 2, session_id: 's-h', request_id: 'q1', approval: { command: 'ls' }
}

function setup(opts: { bots?: BotView[]; rooms?: GroupView[]; hermes?: WatcherState['hermes'] } = {}) {
  const store = new PendingStore()
  let hermes = opts.hermes ?? 'connected'
  const watcherAnswer = vi.fn(() => 'sent' as const)
  const watcher = {
    store,
    state: (): WatcherState => ({
      hermes, bots: opts.bots ?? [bot('crew-test')], settings: {} as never,
      pending: store.list().map(({ settled: _s, settledAt: _t, answerState, answerError, ...rest }) => ({ ...rest, state: answerState ?? ('open' as const), answerable: false, ...(answerError ? { error: answerError } : {}) }))
    }),
    onChange: vi.fn(() => () => undefined),
    answer: watcherAnswer,
    getAvatar: vi.fn(),
    debug: () => []
  } as unknown as Watcher
  let listener: (() => void) | undefined
  let actions = new Map<string, readonly HermesPendingAction[]>()
  const refreshRoom = vi.fn(async () => undefined)
  const groups = {
    state: (): GroupsState => ({ available: true, seatable: [], rooms: opts.rooms ?? [] }),
    pendingActions: () => actions,
    onChange: (l: () => void) => { listener = l; return () => undefined },
    refreshRoom
  } as unknown as GroupWatcher
  const approve = vi.fn(async () => undefined)
  const crew = composeCrewState(watcher, groups, { approve } as unknown as GroupRpc, () => 100)
  return {
    crew, store, approve, refreshRoom, watcherAnswer,
    setHermes: (h: WatcherState['hermes']) => { hermes = h },
    publish: (m: Map<string, readonly HermesPendingAction[]>) => { actions = m; listener?.() }
  }
}

describe('composeCrewState', () => {
  it('adds groups to the state and marks running members working', () => {
    const { crew } = setup({ bots: [bot('crew-test'), bot('reese')], rooms: [room([{ memberId: 'crew-test', status: 'running', tool: null, stalled: false }, { memberId: 'reese', status: 'queued', tool: null, stalled: false }])] })
    const s = crew.state()
    expect(s.groups.rooms).toHaveLength(1)
    expect(s.bots.map(b => b.status)).toEqual(['working', 'idle'])
  })

  it('keeps needs_you over working', () => {
    const { crew } = setup({ bots: [bot('crew-test', 'needs_you')], rooms: [room([{ memberId: 'crew-test', status: 'running', tool: null, stalled: false }])] })
    expect(crew.state().bots[0]?.status).toBe('needs_you')
  })

  it('syncs group approvals into the store on group changes and marks them answerable', () => {
    const t = setup()
    t.publish(new Map([['r1', [action]]]))
    const p = t.crew.state().pending
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ id: 'group:r1:q1', answerable: true, source: 'group' })
  })

  it('routes a group answer to groups.approve and marks it answering', async () => {
    const t = setup()
    t.publish(new Map([['r1', [action]]]))
    expect(t.crew.answer('group:r1:q1', { choice: 'once' })).toBe('sent')
    expect(t.store.get('group:r1:q1')?.answerState).toBe('answering')
    expect(t.crew.answer('group:r1:q1', { choice: 'once' })).toBe('answering')
    await vi.waitFor(() => expect(t.refreshRoom).toHaveBeenCalledWith('r1'))
    expect(t.approve).toHaveBeenCalledWith('r1', { memberId: 'crew-test', taskId: 't1', executionGeneration: 2, choice: 'once', requestId: 'q1' })
    expect(t.watcherAnswer).not.toHaveBeenCalled()
  })

  it('marks a failed group answer failed with the message', async () => {
    const t = setup()
    t.approve.mockRejectedValueOnce(new Error('stale_generation'))
    t.publish(new Map([['r1', [action]]]))
    t.crew.answer('group:r1:q1', { choice: 'deny' })
    await vi.waitFor(() => expect(t.store.get('group:r1:q1')?.answerState).toBe('failed'))
    expect(t.store.get('group:r1:q1')?.answerError).toBe('stale_generation')
    expect(t.refreshRoom).not.toHaveBeenCalled()
  })

  it('returns offline for a group answer while Hermes is down', () => {
    const t = setup()
    t.publish(new Map([['r1', [action]]]))
    t.setHermes('offline')
    expect(t.crew.answer('group:r1:q1', { choice: 'once' })).toBe('offline')
    expect(t.approve).not.toHaveBeenCalled()
    expect(t.store.get('group:r1:q1')?.answerError).toBe('not_connected')
  })

  it('reports not_found and already_resolved for group ids', () => {
    const t = setup()
    t.publish(new Map([['r1', [action]]]))
    t.publish(new Map())
    expect(t.crew.answer('group:r1:q1', { choice: 'once' })).toBe('already_resolved')
  })

  it('delegates non-group answers to the watcher', () => {
    const t = setup()
    expect(t.crew.answer('p-1', { choice: 'once' })).toBe('sent')
    expect(t.watcherAnswer).toHaveBeenCalledWith('p-1', { choice: 'once' })
  })
})
