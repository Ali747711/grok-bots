import { afterEach, describe, expect, it } from 'vitest'

import { setLogSink } from '../src/log.js'
import { DEFAULT_IMAGE, type Docker, type DockerRunner, type RunResult } from '../src/sandbox/docker.js'
import {
  createImagePuller, EMPTY_TALLY, imageStatus, parsePullLine, progressOf, PULL_TIMEOUT_MS, pullErrorOf
} from '../src/sandbox/pull.js'

const feed = (lines: string[]) => lines.reduce(parsePullLine, EMPTY_TALLY)
const result = (outcome: RunResult['outcome'], stderr = '', code: number | null = 1): RunResult =>
  ({ outcome, code, stdout: '', stderr })

describe('pull progress', () => {
  it('counts layers from Pulling fs layer, Waiting and Already exists', () => {
    const tally = feed([
      'aaaaaaaaaaaa: Pulling fs layer', 'bbbbbbbbbbbb: Waiting', 'cccccccccccc: Already exists'
    ])
    expect(progressOf(tally)).toEqual({ layersDone: 1, layersTotal: 3, bytesDone: null, bytesTotal: null })
  })

  it('adds bytes when a Downloading line carries sizes', () => {
    const tally = feed([
      'aaaaaaaaaaaa: Pulling fs layer', 'bbbbbbbbbbbb: Pulling fs layer',
      'aaaaaaaaaaaa: Downloading  12.5MB/50MB'
    ])
    expect(progressOf(tally)).toMatchObject({ bytesDone: 12_500_000, bytesTotal: 50_000_000 })
    const done = parsePullLine(tally, 'aaaaaaaaaaaa: Pull complete')
    expect(progressOf(done)).toMatchObject({ layersDone: 1, bytesDone: 50_000_000, bytesTotal: 50_000_000 })
    const kb = parsePullLine(EMPTY_TALLY, 'aaaaaaaaaaaa: Downloading [==>] 500kB/2GB')
    expect(progressOf(kb)).toMatchObject({ bytesDone: 500_000, bytesTotal: 2_000_000_000 })
  })

  it('ignores lines it does not know and returns the same tally', () => {
    const tally = feed(['aaaaaaaaaaaa: Pulling fs layer'])
    for (const line of ['Digest: sha256:abc', 'Status: Downloaded newer image', '', 'abc: Waiting']) {
      expect(parsePullLine(tally, line)).toBe(tally)
    }
  })
})

describe('pull errors', () => {
  it('classifies pull errors without keeping docker output', () => {
    expect(pullErrorOf(result('exit', 'write: No space left on device'))).toBe('no_space')
    expect(pullErrorOf(result('exit', 'dial tcp: lookup registry-1.docker.io: no such host'))).toBe('network')
    expect(pullErrorOf(result('exit', 'net/http: TLS handshake timeout'))).toBe('network')
    expect(pullErrorOf(result('exit', 'something else'))).toBe('failed')
    expect(pullErrorOf(result('timeout', 'dial tcp'))).toBe('failed')
  })
})

function controlled() {
  const calls: { args: readonly string[]; timeoutMs: number }[] = []
  let finish!: (r: RunResult) => void
  let onLine!: (line: string) => void
  const runner: DockerRunner = {
    run: async () => result('ok', '', 0),
    stream: (args, timeoutMs, cb) => {
      calls.push({ args, timeoutMs })
      onLine = cb
      return new Promise<RunResult>(resolve => { finish = resolve })
    }
  }
  return { runner, calls, line: (l: string) => onLine(l), finish: (r: RunResult) => finish(r) }
}
const tick = () => new Promise(resolve => setTimeout(resolve, 5))

describe('createImagePuller', () => {
  let restore: (() => void) | undefined
  afterEach(() => restore?.())

  it('starts one docker pull for two start calls', async () => {
    const c = controlled()
    const puller = createImagePuller(c.runner)
    expect(puller.start()).toBe('started')
    expect(puller.start()).toBe('running')
    expect(c.calls).toEqual([{ args: ['pull', DEFAULT_IMAGE], timeoutMs: PULL_TIMEOUT_MS }])
    expect(PULL_TIMEOUT_MS).toBe(3_600_000)
    c.finish(result('ok', '', 0))
    await tick()
  })

  it('updates progress while pulling, then keeps the error code after a failure and starts again', async () => {
    const lines: string[] = []
    restore = setLogSink(l => lines.push(l))
    const c = controlled()
    const puller = createImagePuller(c.runner)
    expect(puller.state()).toEqual({ pulling: false, progress: null, error: null })
    puller.start()
    expect(puller.state().pulling).toBe(true)
    c.line('aaaaaaaaaaaa: Pulling fs layer')
    c.line('aaaaaaaaaaaa: Pull complete')
    expect(puller.state().progress).toMatchObject({ layersDone: 1, layersTotal: 1 })
    c.finish(result('exit', 'write: no space left on device'))
    await tick()
    expect(puller.state()).toMatchObject({ pulling: false, error: 'no_space' })
    expect(lines.map(l => JSON.parse(l))).toEqual([
      expect.objectContaining({ level: 'warn', msg: 'sandbox image pull failed', error: 'no_space' })
    ])
    expect(puller.start()).toBe('started')
    expect(puller.state()).toMatchObject({ pulling: true, error: null })
    c.finish(result('ok', '', 0))
    await tick()
    expect(puller.state()).toMatchObject({ pulling: false, error: null })
  })

  it('never logs docker output', async () => {
    const lines: string[] = []
    restore = setLogSink(l => lines.push(l))
    const c = controlled()
    const puller = createImagePuller(c.runner)
    puller.start()
    c.finish(result('exit', 'SECRET-DOCKER-OUTPUT /home/x/path'))
    await tick()
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.join('\n')).not.toContain('SECRET-DOCKER-OUTPUT')
    expect(lines.join('\n')).not.toContain('/home/x')
  })
})

describe('imageStatus', () => {
  const puller = { state: () => ({ pulling: false, progress: null, error: null }), start: () => 'started' as const }

  it('imageStatus skips the inspect when docker is down', async () => {
    let inspected = false
    const docker = {
      status: async () => 'down',
      imagePresent: async () => { inspected = true; return true }
    } as unknown as Docker
    expect(await imageStatus(docker, puller)).toEqual({
      pulling: false, progress: null, error: null, image: DEFAULT_IMAGE, docker: 'down', present: false
    })
    expect(inspected).toBe(false)
  })

  it('reports presence when docker is ok', async () => {
    const docker = { status: async () => 'ok', imagePresent: async () => true } as unknown as Docker
    expect(await imageStatus(docker, puller)).toMatchObject({ docker: 'ok', present: true })
  })
})
