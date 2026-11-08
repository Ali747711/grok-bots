import { beforeEach, describe, expect, it } from 'vitest'

import { HermesRpcError, type Rpc } from '../src/hermes/errors.js'
import { BotMetaWriteError, BotNotFoundError, readBotMeta, updateBotMeta } from '../src/bots/ui-meta.js'

type Obj = Record<string, unknown>

/** Scripted Hermes: a profiles.list/configure pair with real compare-and-swap semantics. */
class FakeRpc {
  rows = new Map<string, { meta?: Obj; rev?: number }>()
  configures: Obj[] = []
  alwaysConflict = false
  rejectWrites = false
  private hook: (() => void) | null = null

  meta(name: string, meta: Obj, rev: number): void {
    this.rows.set(name, { meta, rev })
  }
  onNextConfigure(fn: () => void): void {
    this.hook = fn
  }
  call: Rpc = async <T>(method: string, params: Obj) => {
    if (method === 'profiles.list') {
      return { profiles: [...this.rows].map(([name, r]) => ({
        name,
        ui_meta: r.meta ? { 'hermes-bots': r.meta } : {},
        ui_meta_revisions: r.rev === undefined ? {} : { 'hermes-bots': r.rev }
      })) } as T
    }
    if (method !== 'profiles.configure') throw new HermesRpcError(-32601, 'method not found')
    this.configures.push(params)
    const hook = this.hook
    this.hook = null
    hook?.()
    const row = this.rows.get(params.name as string)!
    const expected = (params.ui_meta_expected_revisions as Obj)['hermes-bots']
    const actual = row.rev ?? 0
    if (this.alwaysConflict || expected !== actual) {
      return { ok: false, applied: { ui_meta: false, ui_meta_conflicts: { 'hermes-bots': { expected, actual } }, ui_meta_revisions: { 'hermes-bots': actual } } } as T
    }
    if (this.rejectWrites) return { ok: false, applied: { ui_meta: false } } as T
    row.meta = (params.ui_meta as Obj)['hermes-bots'] as Obj
    row.rev = actual + 1
    return { ok: true, applied: { ui_meta: true, ui_meta_revisions: { 'hermes-bots': row.rev } } } as T
  }
}

let rpc: FakeRpc
beforeEach(() => {
  rpc = new FakeRpc()
})

describe('readBotMeta', () => {
  it('returns meta and revision, 0 for a profile that never had a look', async () => {
    rpc.meta('scout', { title: 'S' }, 3)
    rpc.rows.set('fresh', {})
    expect(await readBotMeta(rpc.call, 'scout')).toEqual({ meta: { title: 'S' }, revision: 3 })
    expect(await readBotMeta(rpc.call, 'fresh')).toEqual({ meta: null, revision: 0 })
  })

  it('throws BotNotFoundError for a missing row', async () => {
    await expect(readBotMeta(rpc.call, 'nope')).rejects.toBeInstanceOf(BotNotFoundError)
  })
})

describe('updateBotMeta', () => {
  it("keeps a concurrent writer's keys after a conflict", async () => {
    rpc.meta('scout', { title: 'Old', groups: ['ops'] }, 3)
    rpc.onNextConfigure(() => rpc.meta('scout', { title: 'Old', groups: ['ops'], pinned: true }, 4))
    const out = await updateBotMeta(rpc.call, 'scout', { title: 'New' })
    expect(out.meta).toEqual({ title: 'New', groups: ['ops'], pinned: true })
    expect(out.revision).toBe(5)
    expect(rpc.configures).toHaveLength(2)
    expect(rpc.configures.at(-1)).toMatchObject({ ui_meta_expected_revisions: { 'hermes-bots': 4 } })
  })

  it('drops chat and never sends image or pet', async () => {
    rpc.meta('scout', { title: 'T', chat: 'old-id', groups: ['g'] }, 1)
    await updateBotMeta(rpc.call, 'scout', { color: '#fff', image: 'data:x', pet: { a: 1 } } as never)
    expect((rpc.configures[0]!.ui_meta as Obj)['hermes-bots']).toEqual({ title: 'T', groups: ['g'], color: '#fff' })
  })

  it('uses revision 0 for a profile that never had a look', async () => {
    rpc.rows.set('fresh', {})
    const out = await updateBotMeta(rpc.call, 'fresh', { title: 'F' })
    expect(rpc.configures[0]).toMatchObject({ name: 'fresh', ui_meta_expected_revisions: { 'hermes-bots': 0 } })
    expect(out).toEqual({ meta: { title: 'F' }, revision: 1 })
  })

  it('gives up after three conflicts', async () => {
    rpc.meta('scout', { title: 'T' }, 1)
    rpc.alwaysConflict = true
    await expect(updateBotMeta(rpc.call, 'scout', { title: 'N' })).rejects.toMatchObject({ name: 'BotMetaWriteError', reason: 'conflict' })
    expect(rpc.configures).toHaveLength(3)
  })

  it('reports a silently rejected write', async () => {
    rpc.meta('scout', { title: 'T' }, 1)
    rpc.rejectWrites = true
    await expect(updateBotMeta(rpc.call, 'scout', { title: 'N' })).rejects.toEqual(new BotMetaWriteError('rejected'))
    expect(rpc.configures).toHaveLength(1)
  })
})
