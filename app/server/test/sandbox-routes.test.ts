import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createApp } from '../src/app.js'
import { CSRF_COOKIE } from '../src/auth/routes.js'
import { signSession } from '../src/auth/session-cookie.js'
import type { BotDeps } from '../src/bots/create.js'
import type { SandboxDeps } from '../src/bots/sandbox.js'
import { log } from '../src/log.js'
import { type Docker, type DockerState, DockerError, DEFAULT_IMAGE } from '../src/sandbox/docker.js'
import { createImagePuller } from '../src/sandbox/pull.js'
import { FakeRpc } from './fake-rpc.js'
import { HOST, makeDeps, ORIGIN } from './helpers.js'

const base = makeDeps()
const session = signSession(base.secrets.cookie, { sid: 's', exp: base.now() + 60_000 })
const headers = { Host: HOST, Origin: ORIGIN, Cookie: `crew_session=${session}; ${CSRF_COOKIE}=tok`, 'Content-Type': 'application/json', 'X-Crew-CSRF': 'tok' }

type Obj = Record<string, unknown>
let rpc: FakeRpc
let config: Obj
let docker: { [K in keyof Docker]: ReturnType<typeof vi.fn> }
let streams: number
let streamDone: (() => void) | null
let bots: BotDeps
let sandbox: SandboxDeps
let app: ReturnType<typeof createApp>

const plain = (x: unknown): x is Obj => !!x && typeof x === 'object' && !Array.isArray(x)
const merge = (into: Obj, patch: Obj): Obj => {
  const out = { ...into }
  for (const [k, v] of Object.entries(patch)) out[k] = plain(v) && plain(out[k]) ? merge(out[k] as Obj, v) : v
  return out
}
const send = (method: string, path: string, payload?: unknown) =>
  app.request(path, { method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) })

function build(withSandbox = true, withBots = true): void {
  app = createApp({ ...base, ...(withBots ? { bots: withSandbox ? { ...bots, sandbox } : bots } : {}) })
}

beforeEach(() => {
  vi.spyOn(log, 'warn').mockImplementation(() => undefined)
  rpc = new FakeRpc()
  rpc.meta('scout', { title: 'Scout' }, 1)
  rpc.meta('default', { title: 'Hermes' }, 1)
  config = {}
  streams = 0
  streamDone = null
  docker = {
    status: vi.fn(async (): Promise<DockerState> => 'ok'),
    imagePresent: vi.fn(async () => true),
    containers: vi.fn(async () => []),
    memoryMb: vi.fn(async () => null),
    removeContainers: vi.fn(async () => 0),
    cleanupSandboxes: vi.fn(async () => undefined)
  }
  const runner = {
    run: vi.fn(),
    stream: vi.fn(() => { streams += 1; return new Promise(resolve => { streamDone = () => resolve({ outcome: 'ok', code: 0, stdout: '', stderr: '' }) }) })
  }
  const rest = {
    request: async (method: string, _p: string, opts: { body?: unknown } = {}) => {
      if (method === 'GET') return structuredClone(config)
      config = merge(config, (opts.body as { config: Obj }).config)
      return { ok: true }
    }
  }
  bots = { rpc: rpc.call, rest: rest as unknown as BotDeps['rest'], refresh: async () => undefined, now: () => 1 }
  sandbox = {
    docker: docker as unknown as Docker,
    puller: createImagePuller(runner as never),
    hermesHome: '/home/x/.hermes',
    groups: () => ({ available: true, seatable: [], rooms: [] })
  }
  build()
})

describe('sandbox routes', () => {
  it('GET answers the view; 404 for an unknown bot; 503 without sandbox deps', async () => {
    const res = await send('GET', '/crew/bots/scout/sandbox')
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ state: 'off', image: DEFAULT_IMAGE, docker: 'ok', imagePresent: true, container: null, groups: [] })
    expect((await send('GET', '/crew/bots/default/sandbox')).status).toBe(200)
    expect((await send('GET', '/crew/bots/ghost/sandbox')).status).toBe(404)
    expect((await send('GET', '/crew/bots/Bad Name/sandbox')).status).toBe(404)
    build(false)
    const offline = await send('GET', '/crew/bots/scout/sandbox')
    expect([offline.status, await offline.json()]).toEqual([503, { error: 'hermes_offline' }])
    build(true, false)
    expect((await send('GET', '/crew/sandbox/image')).status).toBe(503)
    expect((await send('POST', '/crew/sandbox/image/pull')).status).toBe(503)
  })

  it('PUT on answers the fresh view; 409 docker_unavailable and image_missing; 400 bad_body for extra keys', async () => {
    const on = await send('PUT', '/crew/bots/scout/sandbox', { on: true })
    expect(on.status).toBe(200)
    expect(await on.json()).toMatchObject({ state: 'on' })
    docker.status.mockResolvedValue('down')
    const down = await send('PUT', '/crew/bots/scout/sandbox', { on: true })
    expect([down.status, await down.json()]).toEqual([409, { error: 'docker_unavailable' }])
    docker.status.mockResolvedValue('ok')
    docker.imagePresent.mockResolvedValue(false)
    const missing = await send('PUT', '/crew/bots/scout/sandbox', { on: true })
    expect([missing.status, await missing.json()]).toEqual([409, { error: 'image_missing' }])
    for (const body of [{ on: true, extra: 1 }, { on: 'yes' }, {}]) {
      expect((await send('PUT', '/crew/bots/scout/sandbox', body)).status).toBe(400)
    }
    const bad = await app.request('/crew/bots/scout/sandbox', { method: 'PUT', headers, body: 'nope' })
    expect(((await bad.json()) as Obj).error).toBe('bad_body')
  })

  it('POST reset answers the view and 409 docker_unavailable when docker is down', async () => {
    const ok = await send('POST', '/crew/bots/scout/sandbox/reset')
    expect(ok.status).toBe(200)
    expect(docker.removeContainers).toHaveBeenCalledWith('scout')
    docker.status.mockResolvedValue('missing')
    const down = await send('POST', '/crew/bots/scout/sandbox/reset')
    expect([down.status, await down.json()]).toEqual([409, { error: 'docker_unavailable' }])
  })

  it('GET image answers image, docker, present, pulling, progress and error', async () => {
    const res = await send('GET', '/crew/sandbox/image')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ image: DEFAULT_IMAGE, docker: 'ok', present: true, pulling: false, progress: null, error: null })
  })

  it('POST pull starts one pull for two requests, answers 200 when present and 409 when docker is down', async () => {
    docker.imagePresent.mockResolvedValue(false)
    const [a, b] = await Promise.all([send('POST', '/crew/sandbox/image/pull'), send('POST', '/crew/sandbox/image/pull')])
    expect([a.status, b.status]).toEqual([202, 202])
    expect(streams).toBe(1)
    expect(((await a.json()) as Obj).pulling).toBe(true)
    streamDone?.()
    docker.imagePresent.mockResolvedValue(true)
    const present = await send('POST', '/crew/sandbox/image/pull')
    expect([present.status, ((await present.json()) as Obj).present]).toEqual([200, true])
    expect(streams).toBe(1)
    docker.status.mockResolvedValue('down')
    const down = await send('POST', '/crew/sandbox/image/pull')
    expect([down.status, await down.json()]).toEqual([409, { error: 'docker_unavailable' }])
  })

  it('answers 502 bad_image_name for an invalid docker_image without calling docker', async () => {
    config = { terminal: { docker_image: 'bad image; rm -rf /' } }
    for (const [method, path, body] of [['GET', '/crew/bots/scout/sandbox'], ['PUT', '/crew/bots/scout/sandbox', { on: true }]] as const) {
      const res = await send(method, path, body)
      expect([res.status, await res.json()]).toEqual([502, { error: 'bad_image_name' }])
    }
    for (const name of ['imagePresent', 'containers', 'memoryMb', 'removeContainers', 'cleanupSandboxes'] as const) expect(docker[name]).not.toHaveBeenCalled()
  })

  it('maps a DockerError that escapes to 503 docker_unavailable', async () => {
    docker.containers.mockRejectedValue(new DockerError('failed'))
    const res = await send('GET', '/crew/bots/scout/sandbox')
    expect(res.status).toBe(200)
    docker.status.mockRejectedValue(new DockerError('down'))
    const down = await send('GET', '/crew/bots/scout/sandbox')
    expect([down.status, await down.json()]).toEqual([503, { error: 'docker_unavailable' }])
  })

  it('error bodies never contain a path or docker output', async () => {
    docker.status.mockRejectedValue(new DockerError('failed'))
    docker.imagePresent.mockResolvedValue(false)
    const bodies: string[] = []
    for (const [method, path, body] of [
      ['GET', '/crew/bots/scout/sandbox'], ['PUT', '/crew/bots/scout/sandbox', { on: true }],
      ['POST', '/crew/bots/scout/sandbox/reset'], ['POST', '/crew/sandbox/image/pull']
    ] as const) bodies.push(await (await send(method, path, body)).text())
    docker.status.mockResolvedValue('down')
    for (const [method, path, body] of [['PUT', '/crew/bots/scout/sandbox', { on: true }], ['POST', '/crew/bots/scout/sandbox/reset']] as const) {
      bodies.push(await (await send(method, path, body)).text())
    }
    config = { terminal: { docker_image: '/etc/passwd bad' } }
    docker.status.mockResolvedValue('ok')
    bodies.push(await (await send('GET', '/crew/bots/scout/sandbox')).text())
    for (const text of bodies) {
      expect(text).not.toMatch(/\/home|\/etc|\.hermes|sandboxes|docker (info|rm|ps|pull)/)
      expect(text).not.toContain('passwd')
    }
  })
})
