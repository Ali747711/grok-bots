import { beforeEach, describe, expect, it } from 'vitest'

import { composeSoul } from '../src/bots/soul.js'
import { type BotDraft, type BotDeps, createBot, CreateBotError, finishBot } from '../src/bots/create.js'
import { BotNotFoundError } from '../src/bots/ui-meta.js'
import { HermesRpcError } from '../src/hermes/errors.js'
import { setLogSink } from '../src/log.js'
import { FakeRpc } from './fake-rpc.js'

const draft: BotDraft = { name: 'scout', title: 'Researcher', mission: 'Find papers', look: { shape: 'squircle', color: '#7c3aed' } }
let rpc: FakeRpc
let refreshes: number
let deps: BotDeps
beforeEach(() => {
  rpc = new FakeRpc()
  refreshes = 0
  deps = { rpc: rpc.call, rest: { request: async () => { throw new Error('rest unused') } }, refresh: async () => { refreshes += 1 }, now: () => 1234 }
})

describe('createBot', () => {
  it('calls hermes in the official order with the official params', async () => {
    const result = await createBot(deps, draft)
    expect(rpc.methods()).toEqual(['profiles.create', 'profiles.list', 'profiles.configure', 'setup.runtime_check', 'session.create'])
    expect(rpc.params('profiles.create')).toEqual({ name: 'scout', description: 'Researcher — Find papers', clone_from: 'default',
      share_auth: true, no_skills: false, soul: composeSoul({ name: 'scout', title: 'Researcher', mission: 'Find papers' }) })
    expect(rpc.of('profiles.create')[0]!.timeoutMs).toBe(120_000)
    expect(rpc.params('session.create')).toEqual({ profile: 'scout', title: 'Bot Chat', hidden: true, follow_profile_config: true })
    expect(rpc.params('setup.runtime_check')).toEqual({ profile: 'scout' })
    expect((rpc.configures[0]!.ui_meta as Record<string, unknown>)['hermes-bots']).toEqual({ shape: 'squircle', color: '#7c3aed', imageKind: 'shape', title: 'Researcher', created: 1234 })
    expect(result).toEqual({ name: 'scout', complete: true, steps: { profile: 'ok', look: 'ok', avatar: 'skipped', chat: 'ok' }, needsModel: false })
    expect(refreshes).toBe(1)
  })

  it('sends the model, the avatar and a photo imageKind when given', async () => {
    const image = 'data:image/png;base64,AAAA'
    const result = await createBot(deps, { ...draft, mission: '', image, model: { provider: 'openrouter', model: 'x/y' } })
    expect(rpc.params('profiles.create')).toMatchObject({ description: 'Researcher', model: 'x/y', provider: 'openrouter' })
    expect(rpc.methods()).toEqual(['profiles.create', 'profiles.list', 'profiles.configure', 'profiles.set_asset', 'setup.runtime_check', 'session.create'])
    expect(rpc.params('profiles.set_asset')).toEqual({ name: 'scout', asset: 'avatar', data: image })
    expect(((rpc.configures[0]!.ui_meta as Record<string, unknown>)['hermes-bots'] as Record<string, unknown>).imageKind).toBe('photo')
    expect(result.steps.avatar).toBe('ok')
  })

  it('never sends a kickoff prompt', async () => {
    await createBot(deps, { ...draft, image: 'data:image/png;base64,AAAA' })
    await finishBot(deps, 'scout', {})
    expect(rpc.methods().filter(m => m.startsWith('prompt.') || m === 'session.title')).toEqual([])
  })

  it('reports needsModel when the runtime check says not ok, and ignores a failing check', async () => {
    rpc.handlers.set('setup.runtime_check', () => ({ ok: false }))
    expect((await createBot(deps, draft)).needsModel).toBe(true)
    rpc = new FakeRpc(); deps = { ...deps, rpc: rpc.call }
    rpc.fail('setup.runtime_check', new Error('boom'))
    const result = await createBot(deps, draft)
    expect(result.needsModel).toBe(false)
    expect(result.complete).toBe(true)
  })

  it('keeps going when the look fails and reports it', async () => {
    rpc.fail('profiles.configure', new Error('disk full'))
    const result = await createBot(deps, draft)
    expect(result.steps).toEqual({ profile: 'ok', look: 'failed', avatar: 'skipped', chat: 'ok' })
    expect(result.complete).toBe(false)
    expect(result.error).toEqual({ step: 'look', message: 'disk full' })
    expect(rpc.methods()).toContain('session.create')
    expect(refreshes).toBe(1)
  })

  it('reports a failed avatar and a failed chat independently (first error wins)', async () => {
    rpc.fail('profiles.set_asset', new HermesRpcError(4069, 'asset too large'))
    rpc.fail('session.create', new Error('socket closed'))
    const result = await createBot(deps, { ...draft, image: 'data:image/png;base64,AAAA' })
    expect(result.steps).toMatchObject({ look: 'ok', avatar: 'failed', chat: 'failed' })
    expect(result.error).toEqual({ step: 'avatar', message: 'asset too large' })
  })

  it('maps an existing profile to name_taken without further calls', async () => {
    rpc.fail('profiles.create', new HermesRpcError(4062, "A profile named 'scout' already exists."))
    await expect(createBot(deps, draft)).rejects.toMatchObject({ kind: 'name_taken' })
    expect(rpc.methods()).toEqual(['profiles.create'])
  })

  it('maps other 4062 errors to bad_name with the hermes message and lets other errors through', async () => {
    rpc.fail('profiles.create', new HermesRpcError(4062, 'Invalid profile name'))
    await expect(createBot(deps, draft)).rejects.toEqual(new CreateBotError('bad_name', 'Invalid profile name'))
    rpc.fail('profiles.create', new HermesRpcError(5062, 'internal'))
    await expect(createBot(deps, draft)).rejects.toBeInstanceOf(HermesRpcError)
  })
})

describe('quiet failures are logged', () => {
  const warnings = async (run: () => Promise<unknown>): Promise<Record<string, unknown>[]> => {
    const lines: string[] = []
    const restore = setLogSink(l => lines.push(l))
    try { await run() } finally { restore() }
    return lines.map(l => JSON.parse(l) as Record<string, unknown>).filter(l => l.level === 'warn')
  }

  it('logs one warning when the runtime check fails', async () => {
    rpc.fail('setup.runtime_check', new Error('x'.repeat(300)))
    const logged = await warnings(() => createBot(deps, draft))
    expect(logged).toHaveLength(1)
    expect(logged[0]).toMatchObject({ msg: 'runtime check failed', name: 'scout' })
    expect((logged[0]!.error as string).length).toBe(200)
  })

  it('logs one warning when the roster refresh fails', async () => {
    deps = { ...deps, refresh: async () => { throw new Error('sync down') } }
    const logged = await warnings(() => createBot(deps, draft))
    expect(logged).toEqual([expect.objectContaining({ msg: 'roster refresh failed', error: 'sync down' })])
  })
})

describe('finishBot', () => {
  it('finishes a bot that never got a look', async () => {
    rpc.rows.set('scout', {})
    const result = await finishBot(deps, 'scout', {})
    expect(rpc.methods()).toEqual(['profiles.list', 'profiles.list', 'profiles.configure', 'session.create'])
    expect((rpc.configures[0]!.ui_meta as Record<string, unknown>)['hermes-bots']).toEqual({ shape: 'squircle', color: '#6366f1', imageKind: 'shape', title: 'Scout', created: 1234 })
    expect(result).toMatchObject({ name: 'scout', complete: true, steps: { look: 'ok', avatar: 'skipped', chat: 'ok' } })
    expect(refreshes).toBe(1)
  })

  it('uses the given look, title and image', async () => {
    rpc.rows.set('inbox-triage', {})
    await finishBot(deps, 'inbox-triage', { look: { shape: 'circle', color: '#112233' }, title: 'Triage', image: 'data:image/png;base64,AAAA' })
    expect((rpc.configures[0]!.ui_meta as Record<string, unknown>)['hermes-bots']).toEqual({ shape: 'circle', color: '#112233', imageKind: 'photo', title: 'Triage', created: 1234 })
    expect(rpc.of('profiles.set_asset')).toHaveLength(1)
  })

  it('title-cases the name when no title is given', async () => {
    rpc.rows.set('inbox-triage', {})
    await finishBot(deps, 'inbox-triage', {})
    expect(((rpc.configures[0]!.ui_meta as Record<string, unknown>)['hermes-bots'] as Record<string, unknown>).title).toBe('Inbox Triage')
  })

  it('leaves an existing look alone when finishing', async () => {
    rpc.meta('scout', { title: 'Mine' }, 2)
    const result = await finishBot(deps, 'scout', {})
    expect(rpc.of('profiles.configure')).toHaveLength(0)
    expect(result.steps.look).toBe('skipped')
    expect(result.complete).toBe(true)
  })

  it('rejects an unknown bot', async () => {
    await expect(finishBot(deps, 'ghost', {})).rejects.toBeInstanceOf(BotNotFoundError)
  })
})
