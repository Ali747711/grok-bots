import { beforeEach, describe, expect, it, vi } from 'vitest'

import { log } from '../src/log.js'
import { OFF_MARKER } from '../src/bots/sandbox-state.js'
import { type SandboxDeps, SandboxRefusedError, readSandbox, resetSandbox, setSandbox } from '../src/bots/sandbox.js'
import { NotSavedError } from '../src/bots/edit.js'
import type { BotDeps } from '../src/bots/create.js'
import { DEFAULT_IMAGE, DockerError, type Docker, type DockerState, InvalidImageError } from '../src/sandbox/docker.js'
import type { GroupsState } from '../src/groups/types.js'
import { FakeRpc } from './fake-rpc.js'

type Obj = Record<string, unknown>

/** Hermes's PUT /api/config: dicts deep-merge, arrays are replaced. */
function merge(into: Obj, patch: Obj): Obj {
  const out: Obj = { ...into }
  for (const [key, value] of Object.entries(patch)) {
    const old = out[key]
    const plain = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
    out[key] = plain(value) && plain(old) ? merge(old, value) : value
  }
  return out
}

class FakeConfigRest {
  config: Obj = {}
  readonly requests: { method: string; path: string; query?: unknown; body?: unknown }[] = []
  request = async <T>(method: string, path: string, opts: { query?: unknown; body?: unknown } = {}): Promise<T> => {
    this.requests.push({ method, path, query: opts.query, body: opts.body })
    if (method === 'GET') return structuredClone(this.config) as T
    this.config = merge(this.config, (opts.body as { config: Obj }).config)
    return { ok: true } as T
  }
  get puts() { return this.requests.filter(r => r.method === 'PUT') }
}

let rpc: FakeRpc
let rest: FakeConfigRest
let deps: BotDeps
let sb: SandboxDeps
let docker: { [K in keyof Docker]: ReturnType<typeof vi.fn> }
let changed: string[]
let groups: GroupsState
let refreshes: number

beforeEach(() => {
  vi.spyOn(log, 'warn').mockImplementation(() => undefined)
  rpc = new FakeRpc()
  rpc.meta('ada', { title: 'Ada' }, 1)
  rest = new FakeConfigRest()
  refreshes = 0
  changed = []
  groups = { available: true, seatable: [], rooms: [] }
  deps = { rpc: rpc.call, rest: rest as unknown as BotDeps['rest'], refresh: async () => { refreshes += 1 }, now: () => 1 }
  docker = {
    status: vi.fn(async (): Promise<DockerState> => 'ok'),
    imagePresent: vi.fn(async () => true),
    containers: vi.fn(async () => []),
    memoryMb: vi.fn(async () => null),
    removeContainers: vi.fn(async () => 0),
    cleanupSandboxes: vi.fn(async () => undefined)
  }
  sb = {
    docker: docker as unknown as Docker,
    puller: { state: () => ({ pulling: false, progress: null, error: null }), start: () => 'started' },
    hermesHome: '/home/x/.hermes',
    groups: () => groups,
    onChanged: bot => { changed.push(bot) }
  }
})

const toolsets = () => (rest.config.agent as Obj | undefined)?.disabled_toolsets
const marker = () => (rpc.rows.get('ada')?.meta as Obj | undefined)?.sandbox

describe('readSandbox', () => {
  it('reads on, docker, image, a running container with its memory and the groups the bot is in', async () => {
    rest.config = { terminal: { backend: 'docker' }, agent: { disabled_toolsets: ['browser'] } }
    rpc.meta('ada', { sandbox: { on: true, addedBrowserDisable: true } }, 2)
    docker.containers.mockResolvedValue([{ id: 'a'.repeat(12), running: false }, { id: 'b'.repeat(12), running: true }])
    docker.memoryMb.mockResolvedValue(311)
    groups = { available: true, seatable: [], rooms: [
      { id: 'r1', name: 'Room', members: [{ memberId: 'm', profile: 'ada', handle: 'ada', displayName: null }] },
      { id: 'r2', name: 'Other', members: [{ memberId: 'm', profile: 'bob', handle: 'bob', displayName: null }] }
    ] as unknown as GroupsState['rooms'] }
    const view = await readSandbox(deps, sb, 'ada')
    expect(view).toEqual({
      state: 'on', reasons: [], image: DEFAULT_IMAGE, docker: 'ok', imagePresent: true,
      container: { running: true, memMb: 311 }, addedBrowserDisable: true, groups: [{ id: 'r1', name: 'Room' }]
    })
    expect(rest.requests[0]).toMatchObject({ method: 'GET', path: '/api/config', query: { profile: 'ada', include_defaults: 'false' } })
    expect(docker.memoryMb).toHaveBeenCalledWith('b'.repeat(12))
  })

  it('reports no container when there is none', async () => {
    expect((await readSandbox(deps, sb, 'ada')).container).toBeNull()
  })

  it('reports docker down and skips the image check when docker info times out', async () => {
    docker.status.mockResolvedValue('down')
    const view = await readSandbox(deps, sb, 'ada')
    expect(view).toMatchObject({ docker: 'down', imagePresent: false, container: null })
    expect(docker.imagePresent).not.toHaveBeenCalled()
    expect(docker.containers).not.toHaveBeenCalled()
  })

  it('makes docker down when a docker call fails midway', async () => {
    docker.containers.mockRejectedValue(new DockerError('down'))
    expect(await readSandbox(deps, sb, 'ada')).toMatchObject({ docker: 'down', container: null })
  })

  it('throws InvalidImageError for a bad docker_image before calling docker', async () => {
    rest.config = { terminal: { docker_image: 'bad image;rm' } }
    await expect(readSandbox(deps, sb, 'ada')).rejects.toBeInstanceOf(InvalidImageError)
    expect(docker.imagePresent).not.toHaveBeenCalled()
    expect(docker.containers).not.toHaveBeenCalled()
    expect(docker.memoryMb).not.toHaveBeenCalled()
  })
})

describe('setSandbox', () => {
  it('turns on with one sparse PUT: backend docker, 3072, host user, browser added; marker added', async () => {
    const view = await setSandbox(deps, sb, 'ada', true)
    expect(rest.puts).toHaveLength(1)
    expect(rest.puts[0]).toMatchObject({ path: '/api/config', query: { profile: 'ada' } })
    expect((rest.puts[0]!.body as Obj).config).toEqual({
      terminal: { backend: 'docker', container_memory: 3072, docker_run_as_host_user: true },
      agent: { disabled_toolsets: ['browser'] }
    })
    expect(marker()).toEqual({ on: true, addedBrowserDisable: true })
    expect((rpc.rows.get('ada')?.meta as Obj).title).toBe('Ada')
    expect(changed).toEqual(['ada'])
    expect(refreshes).toBe(1)
    expect(view.state).toBe('on')
  })

  it("keeps the user's own disabled toolsets in the full list it writes, on and off", async () => {
    rest.config = { agent: { disabled_toolsets: ['tts'] } }
    await setSandbox(deps, sb, 'ada', true)
    expect(toolsets()).toEqual(['tts', 'browser'])
    await setSandbox(deps, sb, 'ada', false)
    expect(toolsets()).toEqual(['tts'])
    expect((rest.config.terminal as Obj).backend).toBe('local')
  })

  it('never removes a browser entry the user set before turning on', async () => {
    rest.config = { agent: { disabled_toolsets: ['browser'] } }
    await setSandbox(deps, sb, 'ada', true)
    await setSandbox(deps, sb, 'ada', false)
    for (const put of rest.puts) expect((put.body as { config: Obj }).config).not.toHaveProperty('agent')
    expect(toolsets()).toEqual(['browser'])
  })

  it('refuses to turn on without docker or the image, writing nothing', async () => {
    docker.status.mockResolvedValue('missing')
    await expect(setSandbox(deps, sb, 'ada', true)).rejects.toEqual(new SandboxRefusedError('docker_unavailable'))
    docker.status.mockResolvedValue('ok')
    docker.imagePresent.mockResolvedValue(false)
    await expect(setSandbox(deps, sb, 'ada', true)).rejects.toEqual(new SandboxRefusedError('image_missing'))
    expect(rest.puts).toHaveLength(0)
    expect(rpc.of('profiles.configure')).toHaveLength(0)
  })

  it('turns off with backend local, removes the container, and still answers when docker is down', async () => {
    await setSandbox(deps, sb, 'ada', true)
    docker.status.mockResolvedValue('down')
    docker.removeContainers.mockRejectedValue(new DockerError('down'))
    const view = await setSandbox(deps, sb, 'ada', false)
    expect((rest.config.terminal as Obj).backend).toBe('local')
    expect(marker()).toEqual(OFF_MARKER)
    expect(docker.removeContainers).toHaveBeenCalledWith('ada')
    expect(view).toMatchObject({ state: 'off', docker: 'down' })
  })

  it('serializes two flips of the same bot so the marker matches the config', async () => {
    const on = setSandbox(deps, sb, 'ada', true)
    const off = setSandbox(deps, sb, 'ada', false)
    await Promise.all([on, off])
    expect((rest.config.terminal as Obj).backend).toBe('local')
    expect(marker()).toEqual(OFF_MARKER)
  })

  it('surfaces a marker write failure as not_saved after the config write', async () => {
    rpc.rejectWrites = true
    await expect(setSandbox(deps, sb, 'ada', true)).rejects.toEqual(new NotSavedError('ui_meta'))
    expect(rest.puts).toHaveLength(1)
  })
})

describe('resetSandbox', () => {
  it('resets by removing only containers labelled with the bot and refuses when docker is down', async () => {
    const view = await resetSandbox(deps, sb, 'ada')
    expect(docker.removeContainers).toHaveBeenCalledWith('ada')
    expect(changed).toEqual(['ada'])
    expect(view.docker).toBe('ok')
    docker.status.mockResolvedValue('down')
    await expect(resetSandbox(deps, sb, 'ada')).rejects.toEqual(new SandboxRefusedError('docker_unavailable'))
    docker.status.mockResolvedValue('ok')
    docker.removeContainers.mockRejectedValue(new DockerError('failed'))
    await expect(resetSandbox(deps, sb, 'ada')).rejects.toEqual(new SandboxRefusedError('docker_unavailable'))
  })
})
