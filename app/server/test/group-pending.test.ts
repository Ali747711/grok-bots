import { describe, expect, it, vi } from 'vitest'

import { answerGroupApproval, groupPendingId, hideGroupDuplicates, syncGroupPending } from '../src/groups/group-pending.js'
import type { GroupRpc } from '../src/groups/group-rpc.js'
import type { HermesPendingAction } from '../src/groups/types.js'
import type { PendingView } from '../src/watcher/bot-state.js'
import { PendingStore } from '../src/watcher/pending-store.js'

const approval = (over: Partial<Extract<HermesPendingAction, { kind: 'approval' }>> = {}): HermesPendingAction => ({
  kind: 'approval', member_id: 'crew-test', task_id: 't1', execution_generation: 2, session_id: 's-hidden', request_id: 'q1',
  approval: { command: 'rm -rf x', description: 'delete', choices: ['once', 'deny'] }, ...over
})
const map = (entries: [string, HermesPendingAction[]][]) => new Map(entries)

describe('syncGroupPending', () => {
  it('adds one approval entry per pending action with only once/deny', () => {
    const store = new PendingStore()
    syncGroupPending(store, map([['r1', [approval()]]]), 50)
    syncGroupPending(store, map([['r1', [approval()]]]), 60)
    expect(store.list()).toHaveLength(1)
    expect(store.list()[0]).toMatchObject({
      id: 'group:r1:q1', kind: 'approval', profile: 'crew-test', sessionId: 's-hidden', choices: ['once', 'deny'], source: 'group',
      executionGeneration: 2, receivedAt: 50, command: 'rm -rf x', description: 'delete',
      group: { roomId: 'r1', memberId: 'crew-test', taskId: 't1', requestId: 'q1' }
    })
    expect(groupPendingId('r1', 'q1')).toBe('group:r1:q1')
  })

  it('ignores retry/discard actions', () => {
    const store = new PendingStore()
    syncGroupPending(store, map([['r1', [{ kind: 'retry', member_id: 'a', task_id: 't', execution_generation: 1 }]]]), 1)
    expect(store.list()).toEqual([])
  })

  it('caps the command like 1:1 approvals', () => {
    const store = new PendingStore()
    syncGroupPending(store, map([['r1', [approval({ approval: { command: 'x'.repeat(20_000) } })]]]), 1)
    const entry = store.list()[0]
    expect(entry?.detailTruncated).toBe(true)
    expect(entry?.command).toHaveLength(16_384)
  })

  it('settles an entry when its action disappears from a polled room, or the room is gone', () => {
    const store = new PendingStore()
    syncGroupPending(store, map([['r1', [approval()]], ['r2', [approval({ request_id: 'q2' })]]]), 1)
    syncGroupPending(store, map([['r1', []]]), 2)
    expect(store.list()).toEqual([])
    expect(store.get('group:r1:q1')?.settled).toBe('settled')
    expect(store.get('group:r2:q2')?.settled).toBe('settled')
  })

  it('keeps entries for a room whose poll failed (its previous actions stay in the map)', () => {
    const store = new PendingStore()
    syncGroupPending(store, map([['r1', [approval()]]]), 1)
    syncGroupPending(store, map([['r1', [approval()]]]), 2)
    expect(store.list()).toHaveLength(1)
  })

  it('does not touch non-group entries', () => {
    const store = new PendingStore()
    store.add({ id: 'p-1', kind: 'approval', profile: 'a', sessionId: 's', summary: '', receivedAt: 1, source: 'event' })
    syncGroupPending(store, map([]), 2)
    expect(store.list()).toHaveLength(1)
  })
})

const view = (over: Partial<PendingView>): PendingView => ({ id: 'x', kind: 'approval', profile: 'unknown', sessionId: 's', summary: '', receivedAt: 1, source: 'event', state: 'open', answerable: false, ...over })

describe('hideGroupDuplicates', () => {
  it('drops an unknown entry that duplicates a group approval', () => {
    const group = view({ id: 'group:r:q', profile: 'crew-test', source: 'group', sessionId: 's1' })
    const dup = view({ id: 'p1', sessionId: 's1' })
    const other = view({ id: 'p2', sessionId: 's2' })
    const known = view({ id: 'p3', profile: 'reese', sessionId: 's1' })
    expect(hideGroupDuplicates([group, dup, other, known]).map(p => p.id)).toEqual(['group:r:q', 'p2', 'p3'])
  })
})

describe('answerGroupApproval', () => {
  const entry = () => {
    const store = new PendingStore()
    syncGroupPending(store, map([['r1', [approval()]]]), 1)
    return store.list()[0]!
  }
  it('calls groups.approve with the action coordinates', async () => {
    const approve = vi.fn(async () => undefined)
    await answerGroupApproval({ approve } as unknown as GroupRpc, entry(), 'once')
    expect(approve).toHaveBeenCalledWith('r1', { memberId: 'crew-test', taskId: 't1', executionGeneration: 2, choice: 'once', requestId: 'q1' })
  })
  it('refuses a choice other than once or deny', async () => {
    const approve = vi.fn()
    await expect(answerGroupApproval({ approve } as unknown as GroupRpc, entry(), 'always')).rejects.toThrow('not_answerable')
    expect(approve).not.toHaveBeenCalled()
  })
})
