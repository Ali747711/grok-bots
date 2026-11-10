import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setLogSink } from '../src/log.js'
import type { BotDeps } from '../src/bots/create.js'
import { deleteBot } from '../src/bots/edit.js'
import { SandboxCleanupError, cleanupBeforeDelete, hasDockerSandboxDir, sandboxesDirOf } from '../src/bots/sandbox-cleanup.js'
import type { SandboxDeps } from '../src/bots/sandbox.js'
import { DEFAULT_IMAGE, DockerError, type Docker, type DockerState } from '../src/sandbox/docker.js'

let home: string
let calls: string[]
let state: DockerState
let present: boolean
let removeFails: boolean
let helperFails: boolean
let config: Record<string, unknown>
let lines: string[]
let restoreLog: () => void

const docker: Docker = {
  status: async () => { calls.push('status'); return state },
  imagePresent: async image => { calls.push(`imagePresent ${image}`); return present },
  containers: async () => [],
  memoryMb: async () => null,
  removeContainers: async bot => {
    calls.push(`removeContainers ${bot}`)
    if (removeFails) throw new DockerError('failed')
    return 1
  },
  cleanupSandboxes: async (bot, dir, image) => {
    calls.push(`cleanupSandboxes ${bot} ${dir} ${image}`)
    if (helperFails) throw new DockerError('failed')
  }
}

const rest = {
  request: async (method: string, path: string) => {
    calls.push(`${method} ${path}`)
    return method === 'GET' ? config : { ok: true }
  }
} as unknown as BotDeps['rest']

const sb = (): SandboxDeps => ({ docker, hermesHome: home, groups: () => ({ rooms: [] }) as never, puller: {} as never })
const deps = (): BotDeps => ({ rpc: (async () => ({})) as BotDeps['rpc'], rest, refresh: async () => { calls.push('refresh') }, now: () => 1, sandbox: sb() })
const dirOf = (bot = 'scout') => sandboxesDirOf(home, bot)
const seedDocker = async (bot = 'scout') => { await mkdir(join(dirOf(bot), 'docker', 'ws'), { recursive: true }) }
const reasonOf = async (run: Promise<unknown>) => {
  const error = await run.then(() => null, (e: unknown) => e)
  expect(error).toBeInstanceOf(SandboxCleanupError)
  return (error as SandboxCleanupError).reason
}

beforeEach(async () => {
  lines = []
  restoreLog = setLogSink(line => lines.push(line))
  home = await mkdtemp(join(tmpdir(), 'crew-cleanup-'))
  calls = []
  state = 'ok'
  present = true
  removeFails = false
  helperFails = false
  config = {}
})
afterEach(async () => {
  restoreLog()
  await rm(home, { recursive: true, force: true }) })

describe('sandboxesDirOf and hasDockerSandboxDir', () => {
  it('joins hermes home, profiles, the bot and sandboxes', () => {
    expect(sandboxesDirOf('/h/.hermes', 'scout')).toBe('/h/.hermes/profiles/scout/sandboxes')
  })

  it('is true only when both folders are real directories', async () => {
    expect(await hasDockerSandboxDir(dirOf())).toBe(false)
    await mkdir(dirOf(), { recursive: true })
    expect(await hasDockerSandboxDir(dirOf())).toBe(false)
    await seedDocker()
    expect(await hasDockerSandboxDir(dirOf())).toBe(true)
  })

  it('reports an unreadable path as unreadable, with no path in the message', async () => {
    await mkdir(dirOf(), { recursive: true })
    const loop = join(home, 'loop')
    await symlink(loop, loop)
    const error = await hasDockerSandboxDir(join(loop, 'x')).then(() => null, (e: unknown) => e)
    expect(error).toBeInstanceOf(SandboxCleanupError)
    expect((error as Error).message).toBe('sandbox cleanup failed: unreadable')
    expect((error as Error).message).not.toContain(home)
  })
})

describe('deleteBot with a sandbox', () => {
  it('removes the containers, runs the helper, then deletes the profile', async () => {
    await seedDocker()
    await deleteBot(deps(), 'scout')
    expect(calls).toEqual([
      'status',
      'removeContainers scout',
      'GET /api/config',
      `imagePresent ${DEFAULT_IMAGE}`,
      `cleanupSandboxes scout ${dirOf()} ${DEFAULT_IMAGE}`,
      'DELETE /api/profiles/scout',
      'removeContainers scout',
      'refresh'
    ])
  })

  it('sweeps containers once more after the delete and still resolves when that fails', async () => {
    await seedDocker()
    await deleteBot(deps(), 'scout')
    expect(calls.filter(c => c === 'removeContainers scout').length).toBe(2)
    expect(calls.indexOf('DELETE /api/profiles/scout')).toBeLessThan(calls.lastIndexOf('removeContainers scout'))
    calls = []
    await seedDocker()
    let n = 0
    const flaky = { ...docker, removeContainers: async (bot: string) => { n += 1; if (n === 2) throw new DockerError('failed'); calls.push(`removeContainers ${bot}`); return 1 } }
    const d = deps()
    await expect(deleteBot({ ...d, sandbox: { ...sb(), docker: flaky } }, 'scout')).resolves.toBeUndefined()
    expect(n).toBe(2)
    expect(lines.join('\n')).toContain('"kind":"failed"')
    expect(lines.join('\n')).not.toContain(home)
  })

  it('runs the helper for a bot whose config is local but whose sandboxes/docker folder exists', async () => {
    await seedDocker()
    config = { terminal: { backend: 'local' } }
    await deleteBot(deps(), 'scout')
    expect(calls.some(c => c.startsWith('cleanupSandboxes'))).toBe(true)
    expect(calls).toContain('DELETE /api/profiles/scout')
  })

  it('skips the helper when sandboxes is missing, so Docker never creates it root-owned', async () => {
    await mkdir(join(home, 'profiles', 'scout'), { recursive: true })
    await deleteBot(deps(), 'scout')
    expect(calls).toEqual(['status', 'removeContainers scout', 'DELETE /api/profiles/scout', 'removeContainers scout', 'refresh'])
  })

  it('never runs the helper through a symlinked sandboxes or docker folder', async () => {
    const target = join(home, 'elsewhere')
    await mkdir(join(target, 'docker'), { recursive: true })
    await mkdir(join(home, 'profiles', 'scout'), { recursive: true })
    await symlink(target, dirOf())
    await deleteBot(deps(), 'scout')
    expect(calls.some(c => c.startsWith('cleanupSandboxes'))).toBe(false)
    expect(calls).toContain('DELETE /api/profiles/scout')

    calls = []
    await mkdir(dirOf('pal'), { recursive: true })
    await symlink(target, join(dirOf('pal'), 'docker'))
    await deleteBot(deps(), 'pal')
    expect(calls.some(c => c.startsWith('cleanupSandboxes'))).toBe(false)
    expect(calls).toContain('DELETE /api/profiles/pal')
  })

  it('deletes a never-sandboxed bot when Docker is missing or down', async () => {
    for (const s of ['missing', 'down'] as const) {
      state = s
      calls = []
      await deleteBot(deps(), 'scout')
      expect(calls).toEqual(['status', 'DELETE /api/profiles/scout', 'refresh'])
      expect(lines.join('')).not.toContain(home)
    }
  })

  it('stops before profiles.delete when the folder exists and Docker is down, the image is missing or the helper fails', async () => {
    await seedDocker()
    state = 'down'
    expect(await reasonOf(cleanupBeforeDelete(deps(), sb(), 'scout'))).toBe('docker_unavailable')
    state = 'ok'
    present = false
    expect(await reasonOf(cleanupBeforeDelete(deps(), sb(), 'scout'))).toBe('image_missing')
    present = true
    config = { terminal: { docker_image: 'bad image!' } }
    expect(await reasonOf(cleanupBeforeDelete(deps(), sb(), 'scout'))).toBe('image_missing')
    config = {}
    helperFails = true
    expect(await reasonOf(cleanupBeforeDelete(deps(), sb(), 'scout'))).toBe('helper_failed')
    calls = []
    await expect(deleteBot(deps(), 'scout')).rejects.toBeInstanceOf(SandboxCleanupError)
    expect(calls).not.toContain('DELETE /api/profiles/scout')
  })

  it('stops when Docker is up but the containers cannot be removed', async () => {
    removeFails = true
    expect(await reasonOf(cleanupBeforeDelete(deps(), sb(), 'scout'))).toBe('containers_not_removed')
    expect(calls).toEqual(['status', 'removeContainers scout'])
  })

  it('tells the sandbox the bot changed after a successful delete', async () => {
    const changed: string[] = []
    await deleteBot({ ...deps(), sandbox: { ...sb(), onChanged: bot => changed.push(bot) } }, 'scout')
    expect(changed).toEqual(['scout'])
  })

  it('skips the cleanup when no sandbox is wired', async () => {
    await seedDocker()
    await deleteBot({ ...deps(), sandbox: undefined }, 'scout')
    expect(calls).toEqual(['DELETE /api/profiles/scout', 'refresh'])
  })
})
