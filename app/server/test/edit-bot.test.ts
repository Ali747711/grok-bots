import { beforeEach, describe, expect, it } from 'vitest'

import type { BotDeps } from '../src/bots/create.js'
import { createBot } from '../src/bots/create.js'
import { clearAvatar, deleteBot, NotSavedError, PrimaryBotError, readBotDetail, setAvatar, updateBot } from '../src/bots/edit.js'
import { HermesRestError, HermesRpcError } from '../src/hermes/errors.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

let rpc: FakeRpc
let rest: FakeRest
let refreshes: number
let deps: BotDeps
const metaOf = (call: Record<string, unknown>) => (call.ui_meta as Record<string, unknown>)['hermes-bots'] as Record<string, unknown>

beforeEach(() => {
  rpc = new FakeRpc()
  rest = new FakeRest()
  refreshes = 0
  deps = { rpc: rpc.call, rest: { request: rest.request } as BotDeps['rest'], refresh: async () => { refreshes += 1 }, now: () => 1 }
  rpc.meta('scout', { title: 'Scout', shape: 'circle', color: '#111111', imageKind: 'shape', groups: ['ops'] }, 2)
  rpc.rows.get('scout')!.description = 'Original desc'
  rest.soul('scout', 'Original')
  rest.models.set('scout', { provider: 'openrouter', model: 'a/b' })
})

describe('readBotDetail', () => {
  it('builds the detail from the rpc row, the soul and the rest roster row', async () => {
    expect(await readBotDetail(deps, 'scout')).toEqual({
      name: 'scout', isPrimary: false, title: 'Scout', look: { shape: 'circle', color: '#111111', imageKind: 'shape' }, avatar: null, hidden: false,
      description: 'Original desc', soul: 'Original', model: { provider: 'openrouter', model: 'a/b' }, metaRevision: 2
    })
    expect(rest.requests.map(r => r.path)).toContain('/api/profiles/scout/soul')
  })

  it('treats a missing model and a missing soul file as empty, and shows the primary as Hermes', async () => {
    rpc.rows.set('default', {})
    const detail = await readBotDetail(deps, 'default')
    expect(detail).toMatchObject({ isPrimary: true, title: 'Hermes', soul: '', model: null, metaRevision: 0 })
    rest.models.set('default', { provider: '', model: '' })
    expect((await readBotDetail(deps, 'default')).model).toBeNull()
  })

  it('url-encodes the name in rest paths', async () => {
    rpc.rows.set('a b', {})
    await readBotDetail(deps, 'a b')
    expect(rest.requests.map(r => r.path)).toContain('/api/profiles/a%20b/soul')
  })
})

describe('updateBot', () => {
  it('refuses to overwrite a soul changed since load', async () => {
    rest.soul('scout', 'Edited in the Webapp')
    const out = await updateBot(deps, 'scout', { soul: 'Mine', baseline: { soul: 'Original' } })
    expect(out).toMatchObject({ status: 'conflict', fields: ['soul'], current: { soul: 'Edited in the Webapp' } })
    expect(rest.writes()).toEqual([])
    expect(rpc.methods()).not.toContain('profiles.configure')
  })

  it('reports every changed guarded field and writes nothing, also title', async () => {
    rest.models.set('scout', { provider: 'x', model: 'y' })
    rpc.rows.get('scout')!.description = 'Changed'
    const out = await updateBot(deps, 'scout', {
      title: 'New', description: 'Mine', model: { provider: 'p', model: 'm' },
      baseline: { description: 'Original desc', model: { provider: 'openrouter', model: 'a/b' } }
    })
    expect(out).toMatchObject({ status: 'conflict', fields: ['description', 'model'] })
    expect(rpc.of('profiles.configure')).toHaveLength(0)
  })

  it('does not guard fields without a baseline entry or not in the patch', async () => {
    rest.soul('scout', 'Edited elsewhere')
    const out = await updateBot(deps, 'scout', { description: 'D', baseline: { description: 'Original desc' } })
    expect(out.status).toBe('saved')
  })

  it('saves unchanged baselines, writes ui_meta before the description, then the soul, then refreshes', async () => {
    const out = await updateBot(deps, 'scout', {
      title: 'New', description: 'New desc', soul: 'New soul',
      baseline: { description: 'Original desc', soul: 'Original' }
    })
    expect(rpc.methods().filter(m => m === 'profiles.configure')).toHaveLength(2)
    const [first, second] = rpc.configures
    expect(metaOf(first!)).toEqual({ title: 'New', shape: 'circle', color: '#111111', imageKind: 'shape', groups: ['ops'] })
    expect(second).toEqual({ name: 'scout', description: 'New desc' })
    expect(rest.writes()).toEqual([{ method: 'PUT', path: '/api/profiles/scout/soul', body: { content: 'New soul' } }])
    expect(refreshes).toBe(1)
    expect(out).toMatchObject({ status: 'saved', detail: { title: 'New', description: 'New desc', soul: 'New soul' } })
  })

  it('writes title, look and hidden in one ui_meta write and marks a changed look custom', async () => {
    await updateBot(deps, 'scout', { title: 'T', hidden: true, look: { shape: 'squircle', color: '#222222' } })
    expect(rpc.of('profiles.configure')).toHaveLength(1)
    expect(metaOf(rpc.configures[0]!)).toMatchObject({ title: 'T', hidden: true, shape: 'squircle', color: '#222222', custom: true, groups: ['ops'] })
  })

  it('overlays only the given look keys, keeping a shape Crew does not offer', async () => {
    rpc.meta('scout', { title: 'Scout', shape: 'blobatar:seed1:round', color: '#111111', groups: ['ops'] }, 2)
    await updateBot(deps, 'scout', { look: { color: '#222222' } })
    expect(metaOf(rpc.configures[0]!)).toEqual({ title: 'Scout', shape: 'blobatar:seed1:round', color: '#222222', custom: true, groups: ['ops'] })
    await updateBot(deps, 'scout', { look: { shape: 'sigil-3' } })
    expect(metaOf(rpc.configures[1]!)).toMatchObject({ shape: 'sigil-3', color: '#222222', custom: true })
  })

  it('writes an avatar through the same CAS write, keeping unknown keys', async () => {
    const out = await updateBot(deps, 'scout', { avatar: { type: 'star', color: '#123456' } })
    expect(metaOf(rpc.configures[0]!)).toEqual({ title: 'Scout', shape: 'blob', color: '#123456', imageKind: 'shape', groups: ['ops'], crewAvatar: { type: 'star', color: '#123456' }, custom: true })
    expect(out).toMatchObject({ status: 'saved', detail: { avatar: { type: 'star', color: '#123456' } } })
  })

  it('does not mark custom for a hide-only change', async () => {
    await updateBot(deps, 'scout', { hidden: true })
    expect(metaOf(rpc.configures[0]!)).not.toHaveProperty('custom')
  })

  it('stops before any write when the model needs confirmation', async () => {
    rpc.otherConfigure = () => ({ ok: true, applied: {}, confirm_required: true, confirm_message: 'Expensive model' })
    const out = await updateBot(deps, 'scout', { model: { provider: 'p', model: 'm' }, title: 'T', description: 'D', soul: 'S' })
    expect(out).toEqual({ status: 'confirm_required', message: 'Expensive model' })
    expect(rpc.of('profiles.configure')).toHaveLength(1)
    expect(rest.writes()).toEqual([])
    expect(refreshes).toBe(0)
  })

  it('resends the model with confirm_expensive_model', async () => {
    await updateBot(deps, 'scout', { model: { provider: 'p', model: 'm' }, confirmExpensiveModel: true })
    expect(rpc.configures[0]).toEqual({ name: 'scout', model: 'm', provider: 'p', confirm_expensive_model: true })
    await updateBot(deps, 'scout', { model: { provider: 'p', model: 'm' } })
    expect(rpc.configures[1]).toEqual({ name: 'scout', model: 'm', provider: 'p' })
  })

  it('throws NotSavedError when hermes reports a section as not applied', async () => {
    rpc.otherConfigure = () => ({ ok: false, applied: { description: false } })
    await expect(updateBot(deps, 'scout', { description: 'D' })).rejects.toEqual(new NotSavedError('description'))
    rpc.rejectWrites = true
    await expect(updateBot(deps, 'scout', { title: 'T' })).rejects.toEqual(new NotSavedError('ui_meta'))
  })
})

describe('avatar', () => {
  it('uploads, then marks the look as a custom photo', async () => {
    const detail = await setAvatar(deps, 'scout', 'data:image/png;base64,AAAA')
    expect(rpc.methods().slice(0, 1)).toEqual(['profiles.set_asset'])
    expect(rpc.params('profiles.set_asset')).toEqual({ name: 'scout', asset: 'avatar', data: 'data:image/png;base64,AAAA' })
    expect(metaOf(rpc.configures[0]!)).toMatchObject({ imageKind: 'photo', custom: true })
    expect(detail.look.imageKind).toBe('photo')
    expect(refreshes).toBe(1)
  })

  it('clears the asset, then marks the look as a shape', async () => {
    rpc.meta('scout', { imageKind: 'photo', custom: true }, 3)
    const detail = await clearAvatar(deps, 'scout')
    expect(rpc.params('profiles.set_asset')).toEqual({ name: 'scout', asset: 'avatar', clear: true })
    expect(detail.look.imageKind).toBe('shape')
  })

  it('does not touch ui_meta when the upload is rejected', async () => {
    rpc.fail('profiles.set_asset', new HermesRpcError(4069, 'asset too large'))
    await expect(setAvatar(deps, 'scout', 'data:image/png;base64,AAAA')).rejects.toMatchObject({ code: 4069 })
    expect(rpc.of('profiles.configure')).toHaveLength(0)
  })
})

describe('deleteBot', () => {
  it('refuses to delete the primary bot without any call', async () => {
    await expect(deleteBot(deps, 'default')).rejects.toBeInstanceOf(PrimaryBotError)
    expect(rest.requests).toEqual([])
  })

  it('deletes via rest with a 60 s timeout and refreshes', async () => {
    await deleteBot(deps, 'scout')
    expect(rest.requests).toEqual([{ method: 'DELETE', path: '/api/profiles/scout', timeoutMs: 60_000 }])
    expect(refreshes).toBe(1)
  })

  it('treats settlement_pending as a successful delete', async () => {
    rest.deleteReply = { ok: true, settlement_pending: true, retry_command: 'hermes profile delete scout' }
    await expect(deleteBot(deps, 'scout')).resolves.toBeUndefined()
    expect(refreshes).toBe(1)
  })

  it("forgets the bot's apps after Hermes deleted it, and a forget failure never fails the delete", async () => {
    const order: string[] = []
    const inner = rest.request
    rest.request = (async (method: string, path: string, opts?: never) => { order.push(`${method} ${path}`); return inner(method, path, opts) }) as typeof rest.request
    const withApps = { ...deps, rest: { request: rest.request } as BotDeps['rest'], apps: { forget: async (bot: string) => { order.push(`forget ${bot}`) } } }
    await deleteBot(withApps, 'scout')
    expect(order).toEqual(['DELETE /api/profiles/scout', 'forget scout'])
    const failing = { ...withApps, apps: { forget: async () => { throw new Error('boom') } } }
    await expect(deleteBot(failing, 'scout')).resolves.toBeUndefined()
  })

  it('does not forget apps when the Hermes delete fails', async () => {
    let forgot = false
    const failing = { ...deps, rest: { request: async () => { throw new HermesRestError(500, 'x') } } as unknown as BotDeps['rest'], apps: { forget: async () => { forgot = true } } }
    await expect(deleteBot(failing, 'scout')).rejects.toBeInstanceOf(HermesRestError)
    expect(forgot).toBe(false)
  })

  it('lets a rest failure through', async () => {
    rest.request = async () => { throw new HermesRestError(404, 'Profile scout does not exist') }
    await expect(deleteBot({ ...deps, rest: { request: rest.request } as BotDeps['rest'] }, 'scout')).rejects.toBeInstanceOf(HermesRestError)
  })
})

describe('per-bot write serialization', () => {
  it('makes a delete during an in-flight create wait for it', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    rpc.handlers.set('profiles.create', () => gate.then(() => { rpc.rows.set('fresh', {}); return { ok: true } }))
    const created = createBot(deps, { name: 'fresh', title: 'F', mission: '', avatar: { type: 'circle', color: '#111111' } })
    const deleted = deleteBot(deps, 'fresh')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(rest.requests).toEqual([])
    release()
    await Promise.all([created, deleted])
    expect(rpc.methods().at(-1)).toBe('session.create')
    // create now reads the new bot's config (sandbox step); only the delete is a write.
    expect(rest.requests.filter(r => r.path !== '/api/config' && r.path.startsWith('/api/profiles')).map(r => r.method)).toEqual(['DELETE'])
  })

  it('runs a description save and an avatar change on the same bot one after the other', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    rpc.otherConfigure = () => gate.then(() => ({ ok: true, applied: { description: true } }))
    const saved = updateBot(deps, 'scout', { description: 'D' })
    const avatar = setAvatar(deps, 'scout', 'data:image/png;base64,AAAA')
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(rpc.of('profiles.set_asset')).toHaveLength(0)
    release()
    await Promise.all([saved, avatar])
    expect(rpc.of('profiles.set_asset')).toHaveLength(1)
  })
})
