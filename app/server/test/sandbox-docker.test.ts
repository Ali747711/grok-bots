import { describe, expect, it } from 'vitest'

import {
  cleanupArgs, createDocker, createDockerRunner, DEFAULT_IMAGE, DockerError, InvalidImageError,
  isValidImage, parseMemUsage, type DockerRunner, type RunResult
} from '../src/sandbox/docker.js'

const ok = (stdout = ''): RunResult => ({ outcome: 'ok', code: 0, stdout, stderr: '' })
const fail = (stderr = '', code = 1): RunResult => ({ outcome: 'exit', code, stdout: '', stderr })
const notFound: RunResult = { outcome: 'not_found', code: null, stdout: '', stderr: '' }
const timedOut: RunResult = { outcome: 'timeout', code: null, stdout: '', stderr: '' }

function fakeRunner(...scripted: RunResult[]) {
  const calls: { args: readonly string[]; timeoutMs: number }[] = []
  const queue = [...scripted]
  const runner: DockerRunner = {
    run: async (args, timeoutMs) => { calls.push({ args, timeoutMs }); return queue.shift() ?? ok() },
    stream: async (args, timeoutMs) => { calls.push({ args, timeoutMs }); return queue.shift() ?? ok() }
  }
  return { runner, calls }
}

const ID = 'a1b2c3d4e5f6'
const ID2 = '0123456789abcdef0123'

describe('docker checks', () => {
  it('maps docker info to ok, missing and down', async () => {
    expect(await createDocker(fakeRunner(ok('27.1.0\n')).runner).status()).toBe('ok')
    expect(await createDocker(fakeRunner(ok('')).runner).status()).toBe('down')
    expect(await createDocker(fakeRunner(notFound).runner).status()).toBe('missing')
    expect(await createDocker(fakeRunner(timedOut).runner).status()).toBe('down')
    expect(await createDocker(fakeRunner(fail('Cannot connect')).runner).status()).toBe('down')
  })

  it('passes the exact argv for each check and 5000 ms', async () => {
    const { runner, calls } = fakeRunner(
      ok('27'), ok('sha256:x'), ok(`${ID} running\n`), ok('1MiB / 3GiB'), ok(`${ID} running\n`), ok()
    )
    const docker = createDocker(runner)
    await docker.status()
    await docker.imagePresent('img:1')
    await docker.containers('e2e1')
    await docker.memoryMb(ID)
    await docker.removeContainers('e2e1')
    expect(calls).toEqual([
      { args: ['info', '--format', '{{.ServerVersion}}'], timeoutMs: 5000 },
      { args: ['image', 'inspect', '--format', '{{.Id}}', 'img:1'], timeoutMs: 5000 },
      { args: ['ps', '-a', '--filter', 'label=hermes-profile=e2e1', '--format', '{{.ID}} {{.State}}'], timeoutMs: 5000 },
      { args: ['stats', '--no-stream', '--format', '{{.MemUsage}}', ID], timeoutMs: 5000 },
      { args: ['ps', '-a', '--filter', 'label=hermes-profile=e2e1', '--format', '{{.ID}} {{.State}}'], timeoutMs: 5000 },
      { args: ['rm', '-f', ID], timeoutMs: 5000 }
    ])
  })

  it('treats No such image as absent and other failures as DockerError', async () => {
    expect(await createDocker(fakeRunner(ok('sha256:x')).runner).imagePresent('a')).toBe(true)
    expect(await createDocker(fakeRunner(fail('Error: No such image: a')).runner).imagePresent('a')).toBe(false)
    await expect(createDocker(fakeRunner(notFound).runner).imagePresent('a')).rejects.toMatchObject({ kind: 'missing', message: 'docker missing' })
    await expect(createDocker(fakeRunner(timedOut).runner).imagePresent('a')).rejects.toMatchObject({ kind: 'down' })
    await expect(createDocker(fakeRunner(fail('boom')).runner).imagePresent('a')).rejects.toBeInstanceOf(DockerError)
  })

  it('removes only ids listed for the hermes-profile label and skips rm when none', async () => {
    const listing = `${ID} running\nbad exited\n${ID2} exited\n\nZZZZZZZZZZZZ running\n`
    const first = fakeRunner(ok(listing), ok())
    const docker = createDocker(first.runner)
    expect(await docker.containers('e2e1')).toEqual([{ id: ID, running: true }, { id: ID2, running: false }])
    first.calls.length = 0
    const second = fakeRunner(ok(listing), ok())
    expect(await createDocker(second.runner).removeContainers('e2e1')).toBe(2)
    expect(second.calls[1]).toEqual({ args: ['rm', '-f', ID, ID2], timeoutMs: 5000 })

    const empty = fakeRunner(ok(''))
    expect(await createDocker(empty.runner).removeContainers('e2e1')).toBe(0)
    expect(empty.calls).toHaveLength(1)

    await expect(createDocker(fakeRunner(ok(`${ID} running`), fail('x')).runner).removeContainers('e2e1'))
      .rejects.toMatchObject({ kind: 'failed' })
  })

  it('returns null memory on any failure', async () => {
    expect(await createDocker(fakeRunner(fail('x')).runner).memoryMb(ID)).toBeNull()
    expect(await createDocker(fakeRunner(timedOut).runner).memoryMb(ID)).toBeNull()
  })

  it('builds the exact cleanup argv with 60000 ms', async () => {
    const dir = '/h/.hermes/profiles/e2e1/sandboxes'
    const expected = [
      'run', '--rm', '--network', 'none', '--user', '0:0', '--label', 'crew-cleanup=e2e1',
      '--entrypoint', 'rm', '-v', `${dir}:/s`, DEFAULT_IMAGE, '-rf', '/s/docker'
    ]
    expect(cleanupArgs('e2e1', dir, DEFAULT_IMAGE)).toEqual(expected)
    const { runner, calls } = fakeRunner(ok())
    await createDocker(runner).cleanupSandboxes('e2e1', dir, DEFAULT_IMAGE)
    expect(calls).toEqual([{ args: expected, timeoutMs: 60000 }])
    await expect(createDocker(fakeRunner(fail('x')).runner).cleanupSandboxes('e2e1', dir, DEFAULT_IMAGE))
      .rejects.toMatchObject({ kind: 'failed' })
  })

  it('refuses a bad bot name, a bad image and a sandboxes path with a colon before running anything', async () => {
    const { runner, calls } = fakeRunner()
    const docker = createDocker(runner)
    const dir = '/h/sandboxes'
    await expect(docker.containers('../x')).rejects.toThrow('bad bot name')
    await expect(docker.removeContainers('Bad Name')).rejects.toThrow('bad bot name')
    await expect(docker.cleanupSandboxes('a b', dir, DEFAULT_IMAGE)).rejects.toThrow('bad bot name')
    await expect(docker.cleanupSandboxes('e2e1', dir, '-v /:/x')).rejects.toBeInstanceOf(InvalidImageError)
    await expect(docker.imagePresent('--privileged')).rejects.toThrow('invalid sandbox image name')
    for (const bad of ['/h/a:b', '/h/a,b', 'relative/dir']) {
      await expect(docker.cleanupSandboxes('e2e1', bad, DEFAULT_IMAGE)).rejects.toThrow()
    }
    await expect(docker.memoryMb('not-an-id')).resolves.toBeNull()
    expect(calls).toHaveLength(0)
    expect(isValidImage(DEFAULT_IMAGE)).toBe(true)
    expect(isValidImage('-x')).toBe(false)
    expect(isValidImage('a'.repeat(256))).toBe(false)
  })

  it('parses docker stats memory', () => {
    expect(parseMemUsage('311.2MiB / 3GiB')).toBe(311)
    expect(parseMemUsage('620KiB / 3GiB')).toBe(1)
    expect(parseMemUsage('1.5GiB / 3GiB')).toBe(1536)
    expect(parseMemUsage('n/a')).toBeNull()
  })
})

describe('createDockerRunner (real child processes)', () => {
  it('kills a command that runs past its timeout', async () => {
    const started = Date.now()
    const runner = createDockerRunner(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    const result = await runner.run(['info'], 200)
    expect(result.outcome).toBe('timeout')
    expect(Date.now() - started).toBeLessThan(2000)
  })

  it('reports not_found for a missing binary and exit with stderr', async () => {
    const missing = await createDockerRunner('/nonexistent/docker-bin').run(['info'], 1000)
    expect(missing.outcome).toBe('not_found')
    const failing = createDockerRunner(process.execPath, ['-e', 'console.error("nope");process.exit(3)'])
    expect(await failing.run([], 5000)).toMatchObject({ outcome: 'exit', code: 3, stderr: 'nope\n' })
    const good = createDockerRunner(process.execPath, ['-e', 'console.log("hi")'])
    expect(await good.run([], 5000)).toMatchObject({ outcome: 'ok', code: 0, stdout: 'hi\n' })
  })

  it('streams stdout lines to onLine', async () => {
    const script = 'process.stdout.write("a\\nb\\rc\\npart");process.stderr.write("err");'
    const runner = createDockerRunner(process.execPath, ['-e', script])
    const lines: string[] = []
    const result = await runner.stream([], 5000, line => lines.push(line))
    expect(lines).toEqual(['a', 'b', 'c', 'part'])
    expect(result).toMatchObject({ outcome: 'ok', code: 0, stderr: 'err' })
    const missing = await createDockerRunner('/nonexistent/docker-bin').stream([], 1000, () => {})
    expect(missing.outcome).toBe('not_found')
    const broken = await createDockerRunner('bad\0docker').stream([], 1000, () => {})
    expect(['exit', 'not_found']).toContain(broken.outcome)
    const slow = createDockerRunner(process.execPath, ['-e', 'setInterval(()=>{},1000)'])
    expect((await slow.stream([], 200, () => {})).outcome).toBe('timeout')
  })
})
