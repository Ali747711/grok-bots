import { beforeEach, describe, expect, it } from 'vitest'

import { OFF_MARKER } from '../src/bots/sandbox-state.js'

import { composeSoul } from '../src/bots/soul.js'
import { type BotDraft, type BotDeps, createBot, CreateBotError, finishBot } from '../src/bots/create.js'
import { BotNotFoundError } from '../src/bots/ui-meta.js'
import { HermesRpcError } from '../src/hermes/errors.js'
import { setLogSink } from '../src/log.js'
import { FakeRpc } from './fake-rpc.js'

const draft: BotDraft = { name: 'scout', title: 'Researcher', mission: 'Find papers', avatar: { type: 'square', color: '#7c3aed' } }
let rpc: FakeRpc
let refreshes: number
let deps: BotDeps
type Obj = Record<string, unknown>

/** Per-bot raw config: GET returns it, PUT deep-merges dicts and replaces arrays like Hermes. */
class ConfigRest {
  configs = new Map<string, Obj>()
  puts: { profile: string; config: Obj }[] = []
  deletes: { path: string; query?: Record<string, string>; body?: unknown }[] = []
  failDeletes = false
  request = async <T>(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<T> => {
    const profile = opts.query?.profile ?? ''
    if (method === 'DELETE') {
      this.deletes.push({ path, ...(opts.query ? { query: opts.query } : {}), ...(opts.body !== undefined ? { body: opts.body } : {}) })
      if (this.failDeletes) throw new Error('apps cleanup down')
      return { ok: true } as T
    }
    if (method === 'GET') return structuredClone(this.configs.get(profile) ?? {}) as T
    const config = (opts.body as { config: Obj }).config
    this.puts.push({ profile, config })
    const plain = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
    const merge = (into: Obj, patch: Obj): Obj => Object.fromEntries([...new Set([...Object.keys(into), ...Object.keys(patch)])].map(k =>
      [k, k in patch ? (plain(patch[k]) && plain(into[k]) ? merge(into[k], patch[k]) : patch[k]) : into[k]]))
    this.configs.set(profile, merge(this.configs.get(profile) ?? {}, config))
    return { ok: true } as T
  }
}
let rest: ConfigRest
const sandboxMeta = (): unknown => (rpc.rows.get('scout')?.meta as Obj | undefined)?.sandbox
const agentOf = (): Obj | undefined => rest.configs.get('scout')?.agent as Obj | undefined
const terminalOf = (): Obj => rest.configs.get('scout')?.terminal as Obj

beforeEach(() => {
  rpc = new FakeRpc()
  rpc.meta('default', { title: 'Hermes' }, 1)
  rpc.handlers.set('reload.mcp', () => ({ status: 'reloaded' }))
  rest = new ConfigRest()
  // Hermes's clone copies the primary's config; here the primary is plain.
  rest.configs.set('scout', {})
  refreshes = 0
  deps = { rpc: rpc.call, rest: rest as unknown as BotDeps['rest'], refresh: async () => { refreshes += 1 }, now: () => 1234 }
})

describe('createBot', () => {
  it('calls hermes in the official order with the official params', async () => {
    const result = await createBot(deps, draft)
    expect(rpc.methods()).toEqual(['profiles.create', 'reload.mcp', 'profiles.list', 'profiles.list', 'profiles.configure', 'setup.runtime_check', 'session.create'])
    expect(rpc.params('profiles.create')).toEqual({ name: 'scout', description: 'Find papers', clone_from: 'default',
      share_auth: true, no_skills: false, soul: composeSoul({ name: 'scout', title: 'Researcher', mission: 'Find papers' }) })
    expect(rpc.of('profiles.create')[0]!.timeoutMs).toBe(120_000)
    expect(rpc.params('session.create')).toEqual({ profile: 'scout', title: 'Bot Chat', hidden: true, follow_profile_config: true })
    expect(rpc.params('setup.runtime_check')).toEqual({ profile: 'scout' })
    expect((rpc.configures[0]!.ui_meta as Record<string, unknown>)['hermes-bots']).toEqual({ crewAvatar: { type: 'square', color: '#7c3aed' }, shape: 'squircle', color: '#7c3aed', custom: true, imageKind: 'shape', title: 'Researcher', created: 1234, sandbox: OFF_MARKER })
    expect(result).toEqual({ name: 'scout', complete: true, steps: { profile: 'ok', apps: 'ok', sandbox: 'ok', look: 'ok', avatar: 'skipped', chat: 'ok' }, needsModel: false })
    expect(refreshes).toBe(1)
  })

  it('sends the model, the avatar and a photo imageKind when given', async () => {
    const image = 'data:image/png;base64,AAAA'
    const result = await createBot(deps, { ...draft, mission: '', image, model: { provider: 'openrouter', model: 'x/y' } })
    expect(rpc.params('profiles.create')).toMatchObject({ description: '', model: 'x/y', provider: 'openrouter' })
    expect(rpc.methods()).toEqual(['profiles.create', 'reload.mcp', 'profiles.list', 'profiles.list', 'profiles.configure', 'profiles.set_asset', 'setup.runtime_check', 'session.create'])
    expect(rpc.params('profiles.set_asset')).toEqual({ name: 'scout', asset: 'avatar', data: image })
    expect(((rpc.configures[0]!.ui_meta as Record<string, unknown>)['hermes-bots'] as Record<string, unknown>).imageKind).toBe('photo')
    expect(result.steps.avatar).toBe('ok')
  })

  it('writes a chosen role with the look and nothing for null or absent', async () => {
    await createBot(deps, { ...draft, role: 'ops' })
    expect(((rpc.configures[0]!.ui_meta as Obj)['hermes-bots'] as Obj).role).toBe('ops')
    for (const role of [null, undefined]) {
      rpc = new FakeRpc(); rpc.meta('default', {}, 1); deps = { ...deps, rpc: rpc.call }
      await createBot(deps, { ...draft, name: 'other', ...(role === null ? { role } : {}) })
      expect(((rpc.configures[0]!.ui_meta as Obj)['hermes-bots'] as Obj)).not.toHaveProperty('role')
    }
  })

  it('never sends a kickoff prompt', async () => {
    await createBot(deps, { ...draft, image: 'data:image/png;base64,AAAA' })
    await finishBot(deps, 'scout', {})
    expect(rpc.methods().filter(m => m.startsWith('prompt.') || m === 'session.title')).toEqual([])
  })

  it('reports needsModel when the runtime check says not ok, and ignores a failing check', async () => {
    rpc.handlers.set('setup.runtime_check', () => ({ ok: false }))
    expect((await createBot(deps, draft)).needsModel).toBe(true)
    rpc = new FakeRpc(); rpc.meta('default', {}, 1); deps = { ...deps, rpc: rpc.call }
    rpc.fail('setup.runtime_check', new Error('boom'))
    const result = await createBot(deps, draft)
    expect(result.needsModel).toBe(false)
    expect(result.complete).toBe(true)
  })

  it('keeps going when the look fails and reports it', async () => {
    rpc.fail('profiles.configure', new Error('disk full'))
    const result = await createBot(deps, draft)
    expect(result.steps).toEqual({ profile: 'ok', apps: 'ok', sandbox: 'ok', look: 'failed', avatar: 'skipped', chat: 'ok' })
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

describe('createBot sandbox choice', () => {
  const primaryOn = (added: boolean): void => {
    rpc.meta('default', { title: 'Hermes', sandbox: { on: true, addedBrowserDisable: added } }, 2)
    rest.configs.set('scout', {
      terminal: { backend: 'docker', container_memory: 3072, docker_run_as_host_user: true },
      agent: { disabled_toolsets: ['tts', 'browser'] }
    })
  }

  it('writes the choice explicitly: nothing when unticked from a local clone, docker + 3072 + host user + browser when ticked', async () => {
    await createBot(deps, draft)
    expect(rest.puts).toEqual([])
    expect(sandboxMeta()).toEqual(OFF_MARKER)
    rpc.rows.set('scout', {}); rest.puts = []; rest.configs.set('scout', {})
    await createBot(deps, { ...draft, sandbox: true })
    expect(rest.puts).toEqual([{ profile: 'scout', config: {
      terminal: { backend: 'docker', container_memory: 3072, docker_run_as_host_user: true },
      agent: { disabled_toolsets: ['browser'] }
    } }])
    expect(sandboxMeta()).toEqual({ on: true, addedBrowserDisable: true })
  })

  it('leaves a cloned non-docker backend alone when unticked', async () => {
    rest.configs.set('scout', { terminal: { backend: 'ssh' } })
    await createBot(deps, draft)
    expect(rest.puts).toEqual([])
    expect(terminalOf().backend).toBe('ssh')
  })

  it('removes a Crew-added browser cloned from a sandboxed primary when unticked', async () => {
    primaryOn(true)
    await createBot(deps, draft)
    expect(terminalOf().backend).toBe('local')
    expect(agentOf()?.disabled_toolsets).toEqual(['tts'])
    expect(sandboxMeta()).toEqual(OFF_MARKER)
  })

  it("keeps the primary's Crew browser entry and marker when ticked from a sandboxed primary", async () => {
    primaryOn(true)
    await createBot(deps, { ...draft, sandbox: true })
    expect(agentOf()?.disabled_toolsets).toEqual(['tts', 'browser'])
    expect(sandboxMeta()).toEqual({ on: true, addedBrowserDisable: true })
  })

  it('keeps a browser entry the user set on the primary', async () => {
    primaryOn(false)
    await createBot(deps, draft)
    expect(agentOf()?.disabled_toolsets).toEqual(['tts', 'browser'])
    expect(rest.puts[0]!.config).toEqual({ terminal: { backend: 'local' } })
    expect(sandboxMeta()).toEqual(OFF_MARKER)
    rpc.rows.set('scout', {})
    await createBot(deps, { ...draft, sandbox: true })
    expect(sandboxMeta()).toEqual({ on: true, addedBrowserDisable: false })
    expect(agentOf()?.disabled_toolsets).toEqual(['tts', 'browser'])
  })

  it('reads the primary marker, never the clone', async () => {
    primaryOn(true)
    rpc.meta('scout', { sandbox: { on: true, addedBrowserDisable: false } }, 1)
    await createBot(deps, draft)
    expect(agentOf()?.disabled_toolsets).toEqual(['tts'])
  })

  it('stores the marker with the look, so a failed look still leaves the bot unfinished', async () => {
    rpc.rejectWrites = true
    const result = await createBot(deps, { ...draft, sandbox: true })
    expect(result.steps).toMatchObject({ sandbox: 'ok', look: 'failed' })
    expect(rpc.of('profiles.configure').every(c => 'ui_meta' in c.params)).toBe(true)
    expect(rpc.rows.get('scout')?.rev).toBeUndefined()
    expect(rpc.rows.get('scout')?.meta).toBeUndefined()
  })

  it('removes a crew_apps server and its token cloned from the primary before the bot is used', async () => {
    await createBot(deps, draft)
    expect(rest.deletes).toEqual([
      { path: '/api/mcp/servers/crew_apps', query: { profile: 'scout' } },
      { path: '/api/env', body: { key: 'MCP_CREW_APPS_API_KEY', profile: 'scout' } }
    ])
    expect(rest.deletes.some(d => d.query?.profile === 'default' || (d.body as { profile?: string } | undefined)?.profile === 'default')).toBe(false)
  })

  it('drops app-tool always grants cloned from the primary and keeps the rest', async () => {
    rest.configs.set('scout', { command_allowlist: ['mcp:crew_apps/GITHUB_CREATE_AN_ISSUE', 'ls'] })
    await createBot(deps, draft)
    expect(rest.configs.get('scout')?.command_allowlist).toEqual(['ls'])
    expect(rest.puts.some(p => p.profile === 'default')).toBe(false)
  })

  it('reads a string allowlist and writes nothing when no app grant is present', async () => {
    rest.configs.set('scout', { command_allowlist: "['mcp:crew_apps/X', 'ls']" })
    await createBot(deps, draft)
    expect(rest.configs.get('scout')?.command_allowlist).toEqual(['ls'])
    rest.puts.length = 0
    rest.configs.set('scout', { command_allowlist: ['ls', 'pwd'] })
    await finishBot(deps, 'scout', {})
    expect(rest.puts.some(p => 'command_allowlist' in p.config)).toBe(false)
  })

  it('replaces the cloned apps entry and tells Hermes to reload the bot before its chat exists', async () => {
    const order: string[] = []
    const request = rest.request
    rest.request = (async (method: string, path: string, opts?: { query?: Record<string, string>; body?: unknown }) => {
      if (method === 'DELETE') order.push(`DELETE ${path}`)
      return request(method, path, opts)
    }) as typeof rest.request
    const call = rpc.call
    deps = { ...deps, rpc: (async (method: string, params: Record<string, unknown>, timeoutMs?: number) => {
      order.push(method)
      return call(method, params, timeoutMs)
    }) as BotDeps['rpc'] }
    await createBot(deps, draft)
    expect(order.slice(0, 4)).toEqual(['profiles.create', 'DELETE /api/mcp/servers/crew_apps', 'DELETE /api/env', 'reload.mcp'])
    expect(order.indexOf('reload.mcp')).toBeLessThan(order.indexOf('session.create'))
    expect(rpc.params('reload.mcp')).toEqual({ profile: 'scout', confirm: true })
    expect(rpc.of('reload.mcp').some(c => c.params.profile === 'default')).toBe(false)
  })

  it('still finishes the bot when the reload nudge fails: the relay refuses the stale connection anyway', async () => {
    rpc.fail('reload.mcp', new HermesRpcError(-1, 'busy'))
    const result = await createBot(deps, draft)
    expect(result.complete).toBe(true)
    expect(result.steps).toMatchObject({ apps: 'ok', chat: 'ok' })
  })

  it('fails closed when the apps entry cannot be removed: no reload, no chat, and Finish setup retries it', async () => {
    rest.failDeletes = true
    const result = await createBot(deps, draft)
    expect(result.steps).toMatchObject({ apps: 'failed', sandbox: 'ok', look: 'ok', chat: 'skipped' })
    expect(result.error).toEqual({ step: 'apps', message: 'apps cleanup down' })
    expect(result.complete).toBe(false)
    expect(rpc.methods()).not.toContain('session.create')
    expect(rpc.methods()).not.toContain('reload.mcp')
    const still = await finishBot(deps, 'scout', {})
    expect(still.steps).toMatchObject({ apps: 'failed', chat: 'skipped' })
    expect(still.complete).toBe(false)
    expect(rpc.methods()).not.toContain('session.create')
    rest.failDeletes = false
    rest.deletes.length = 0
    const finished = await finishBot(deps, 'scout', {})
    expect(finished.steps).toMatchObject({ apps: 'ok', chat: 'ok' })
    expect(finished.complete).toBe(true)
    expect(rest.deletes).toHaveLength(2)
    expect(rpc.methods()).toContain('session.create')
  })

  it("replaces the primary's relay token when a new bot's strip fails, in create and again in Finish setup, never the bot's own", async () => {
    const rotated: string[] = []
    deps = { ...deps, apps: { forget: async () => undefined, rotate: async bot => { rotated.push(bot); return true } } }
    await createBot(deps, draft)
    expect(rotated).toEqual([])
    rest.failDeletes = true
    const result = await createBot(deps, { ...draft, name: 'scout2' })
    expect(result.steps).toMatchObject({ apps: 'failed', chat: 'skipped' })
    expect(rotated).toEqual(['default'])
    const still = await finishBot(deps, 'scout2', {})
    expect(still.complete).toBe(false)
    expect(rotated).toEqual(['default', 'default'])
    rest.failDeletes = false
    expect((await finishBot(deps, 'scout2', {})).complete).toBe(true)
    expect(rotated).toEqual(['default', 'default'])
  })

  it('logs a failed or unconfirmed rotation without a token and keeps the bot incomplete so Finish setup retries both', async () => {
    const warnings = async (run: () => Promise<unknown>): Promise<Record<string, unknown>[]> => {
      const lines: string[] = []
      const restore = setLogSink(l => lines.push(l))
      try { await run() } finally { restore() }
      return lines.map(l => JSON.parse(l) as Record<string, unknown>).filter(l => l.level === 'warn')
    }
    rest.failDeletes = true
    const attempts: string[] = []
    deps = { ...deps, apps: { forget: async () => undefined, rotate: async bot => { attempts.push(bot); throw new Error('hermes down tok_secret_value') } } }
    const logged = await warnings(() => createBot(deps, draft))
    expect(logged).toEqual([expect.objectContaining({ msg: 'primary apps token rotation failed', name: 'scout', error: 'Error' })])
    expect(JSON.stringify(logged)).not.toContain('tok_secret_value')
    deps = { ...deps, apps: { forget: async () => undefined, rotate: async bot => { attempts.push(bot); return false } } }
    const again = await warnings(async () => {
      const result = await finishBot(deps, 'scout', {})
      expect(result.complete).toBe(false)
      expect(result.steps).toMatchObject({ apps: 'failed', chat: 'skipped' })
    })
    expect(again).toEqual([expect.objectContaining({ msg: 'primary apps token rotation not confirmed', name: 'scout' })])
    expect(attempts).toEqual(['default', 'default'])
  })

  it('Finish setup on a finished bot asks for its apps entry to be restored after the strip; create never does', async () => {
    const restored: string[] = []
    deps = { ...deps, apps: { forget: async () => undefined, restore: async bot => { restored.push(bot) } } }
    await createBot(deps, draft)
    expect(restored).toEqual([])
    const finished = await finishBot(deps, 'scout', {})
    expect(finished.steps).toMatchObject({ apps: 'ok', chat: 'ok' })
    expect(restored).toEqual(['scout'])
    rest.failDeletes = true
    await finishBot(deps, 'scout', {})
    expect(restored).toEqual(['scout'])
  })

  it('fails closed when the cloned app grants cannot be rewritten', async () => {
    rest.configs.set('scout', { command_allowlist: ['mcp:crew_apps/GITHUB_DELETE_A_REPOSITORY', 'ls'] })
    const request = rest.request
    rest.request = (async (method: string, path: string, opts?: { query?: Record<string, string>; body?: unknown }) => {
      if (method === 'PUT' && 'command_allowlist' in ((opts?.body as { config?: object } | undefined)?.config ?? {})) throw new Error('config write down')
      return request(method, path, opts)
    }) as typeof rest.request
    const result = await createBot(deps, draft)
    expect(result.steps).toMatchObject({ apps: 'failed', chat: 'skipped' })
    expect(rpc.methods()).not.toContain('session.create')
  })

  it('reports a failed sandbox step and still runs the later steps', async () => {
    let reads = 0 // the first read belongs to the apps step
    const failing = { request: async (method: string) => { if (method === 'DELETE' || (method === 'GET' && reads++ === 0)) return {}; throw new Error('config down') } }
    deps = { ...deps, rest: failing as unknown as BotDeps['rest'] }
    const result = await createBot(deps, { ...draft, image: 'data:image/png;base64,AAAA' })
    expect(result.steps).toEqual({ profile: 'ok', apps: 'ok', sandbox: 'failed', look: 'ok', avatar: 'ok', chat: 'ok' })
    expect(result.complete).toBe(false)
    expect(result.error).toEqual({ step: 'sandbox', message: 'config down' })
    expect(rpc.methods()).toContain('session.create')
    expect((rpc.rows.get('scout')?.meta as Obj).sandbox).toBeUndefined()
    expect(refreshes).toBe(1)
  })

  it('drops the roster sandbox cache for the new bot', async () => {
    const changed: string[] = []
    deps = { ...deps, sandbox: { onChanged: (bot: string) => { changed.push(bot) } } as unknown as BotDeps['sandbox'] }
    await createBot(deps, draft)
    expect(changed).toEqual(['scout'])
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
  it('finishes a bot that never got a look, deriving its avatar type from the handle', async () => {
    rpc.rows.set('scout', {})
    const result = await finishBot(deps, 'scout', {})
    expect(rpc.methods()).toEqual(['profiles.list', 'reload.mcp', 'profiles.list', 'profiles.configure', 'session.create'])
    expect((rpc.configures[0]!.ui_meta as Record<string, unknown>)['hermes-bots']).toEqual({ crewAvatar: { type: 'ghost' }, shape: 'blob', color: '#F4F2FA', custom: true, imageKind: 'shape', title: 'Scout', created: 1234 })
    expect(result).toMatchObject({ name: 'scout', complete: true, steps: { look: 'ok', avatar: 'skipped', chat: 'ok' } })
    expect(refreshes).toBe(1)
  })

  it('uses the given avatar, title and image', async () => {
    rpc.rows.set('inbox-triage', {})
    await finishBot(deps, 'inbox-triage', { avatar: { type: 'circle', color: '#112233' }, title: 'Triage', image: 'data:image/png;base64,AAAA' })
    expect((rpc.configures[0]!.ui_meta as Record<string, unknown>)['hermes-bots']).toEqual({ crewAvatar: { type: 'circle', color: '#112233' }, shape: 'circle', color: '#112233', custom: true, imageKind: 'photo', title: 'Triage', created: 1234 })
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
