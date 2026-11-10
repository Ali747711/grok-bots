import { execFile, spawn } from 'node:child_process'
import { isAbsolute } from 'node:path'

import { PROFILE_NAME_RE } from '../bots/names.js'

export const DOCKER_TIMEOUT_MS = 5_000
export const CLEANUP_TIMEOUT_MS = 60_000
export const DEFAULT_IMAGE = 'nousresearch/hermes-sandbox:desktop'

const MAX_BUFFER = 1024 * 1024
const STDERR_KEEP = 64 * 1024
const ID_RE = /^[0-9a-f]{12,64}$/
const IMAGE_RE = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,254}$/

export type DockerState = 'ok' | 'missing' | 'down'

export interface RunResult {
  readonly outcome: 'ok' | 'not_found' | 'timeout' | 'exit'
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

export interface DockerRunner {
  /** Never rejects. */
  run(args: readonly string[], timeoutMs: number): Promise<RunResult>
  /** Never rejects. Calls onLine for each stdout line; keeps the last 64 KiB of stderr. */
  stream(args: readonly string[], timeoutMs: number, onLine: (line: string) => void): Promise<RunResult>
}

interface ExecFailure { code?: number | string; killed?: boolean; signal?: string; stderr?: string; stdout?: string }

function fromExecError(error: ExecFailure, stdout: string, stderr: string): RunResult {
  if (error.code === 'ENOENT') return { outcome: 'not_found', code: null, stdout, stderr }
  if (error.killed || error.signal === 'SIGKILL') return { outcome: 'timeout', code: null, stdout, stderr }
  return { outcome: 'exit', code: typeof error.code === 'number' ? error.code : null, stdout, stderr }
}

/** The server's only gateway to Docker: fixed argv, no shell, SIGKILL on timeout. `prefix` is for tests. */
export function createDockerRunner(bin = 'docker', prefix: readonly string[] = []): DockerRunner {
  const run: DockerRunner['run'] = (args, timeoutMs) =>
    new Promise(resolve => {
      execFile(bin, [...prefix, ...args], { timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_BUFFER, shell: false },
        (error, stdout, stderr) => {
          if (!error) return resolve({ outcome: 'ok', code: 0, stdout, stderr })
          resolve(fromExecError(error as ExecFailure, stdout ?? '', stderr ?? ''))
        })
    })
  const stream: DockerRunner['stream'] = (args, timeoutMs, onLine) =>
    new Promise(resolve => {
      let settled = false
      let pending = ''
      let stderr = ''
      let timedOut = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (result: RunResult) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        if (pending) onLine(pending)
        resolve(result)
      }
      let child: ReturnType<typeof spawn>
      try {
        child = spawn(bin, [...prefix, ...args], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
      } catch (error) {
        // spawn can throw synchronously (a bad argument); the interface says stream never rejects.
        return finish(fromExecError(error as ExecFailure, '', ''))
      }
      timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, timeoutMs)
      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        const parts = (pending + chunk).split(/[\r\n]/)
        pending = parts.pop() ?? ''
        for (const part of parts) if (part) onLine(part)
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-STDERR_KEEP) })
      child.on('error', error =>
        finish(fromExecError(error as ExecFailure, '', stderr)))
      child.on('close', code => {
        if (timedOut) return finish({ outcome: 'timeout', code: null, stdout: '', stderr })
        finish({ outcome: code === 0 ? 'ok' : 'exit', code, stdout: '', stderr })
      })
    })
  return { run, stream }
}

export class DockerError extends Error {
  constructor(readonly kind: 'missing' | 'down' | 'failed') {
    super(`docker ${kind}`)
    this.name = 'DockerError'
  }
}

export class InvalidImageError extends Error {
  constructor() {
    super('invalid sandbox image name')
    this.name = 'InvalidImageError'
  }
}

export interface ContainerInfo { readonly id: string; readonly running: boolean }

export interface Docker {
  status(): Promise<DockerState>
  imagePresent(image: string): Promise<boolean>
  containers(bot: string): Promise<readonly ContainerInfo[]>
  memoryMb(id: string): Promise<number | null>
  removeContainers(bot: string): Promise<number>
  cleanupSandboxes(bot: string, sandboxesDir: string, image: string): Promise<void>
}

export function isValidImage(image: string): boolean {
  return IMAGE_RE.test(image)
}

/** '311.2MiB / 3GiB' becomes 311 (MiB, rounded, at least 1); anything unparseable is null. */
export function parseMemUsage(text: string): number | null {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(B|KiB|MiB|GiB|TiB|kB|MB|GB|TB)\b/.exec(text)
  if (!match) return null
  const factor: Record<string, number> = {
    B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4, kB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12
  }
  const bytes = Number(match[1]) * (factor[match[2] ?? 'B'] ?? 1)
  return Math.max(1, Math.round(bytes / 1024 ** 2))
}

function assertBot(bot: string): void {
  if (!PROFILE_NAME_RE.test(bot)) throw new Error('bad bot name')
}

function assertImage(image: string): void {
  if (!isValidImage(image)) throw new InvalidImageError()
}

function assertSandboxesDir(dir: string): void {
  if (!isAbsolute(dir) || dir.includes(':') || dir.includes(',')) throw new Error('bad sandboxes path')
}

/** The cleanup helper argv (facts 11.2 step 4): removes root-owned mountpoints as uid 0 with no network. */
export function cleanupArgs(bot: string, sandboxesDir: string, image: string): readonly string[] {
  assertBot(bot)
  assertImage(image)
  assertSandboxesDir(sandboxesDir)
  return [
    'run', '--rm', '--network', 'none', '--user', '0:0', '--label', `crew-cleanup=${bot}`,
    '--entrypoint', 'rm', '-v', `${sandboxesDir}:/s`, image, '-rf', '/s/docker'
  ]
}

function parseContainers(stdout: string): readonly ContainerInfo[] {
  const found: ContainerInfo[] = []
  for (const line of stdout.split('\n')) {
    const [id, state] = line.trim().split(/\s+/)
    if (id && ID_RE.test(id)) found.push({ id, running: state === 'running' })
  }
  return found
}

export function createDocker(runner: DockerRunner): Docker {
  const check = (args: readonly string[]) => runner.run(args, DOCKER_TIMEOUT_MS)
  const containers = async (bot: string): Promise<readonly ContainerInfo[]> => {
    assertBot(bot)
    const result = await check(['ps', '-a', '--filter', `label=hermes-profile=${bot}`, '--format', '{{.ID}} {{.State}}'])
    if (result.outcome !== 'ok') throw new DockerError(result.outcome === 'not_found' ? 'missing' : 'down')
    return parseContainers(result.stdout)
  }
  return {
    async status() {
      const result = await check(['info', '--format', '{{.ServerVersion}}'])
      if (result.outcome === 'not_found') return 'missing'
      return result.outcome === 'ok' && result.stdout.trim() ? 'ok' : 'down'
    },
    async imagePresent(image) {
      assertImage(image)
      const result = await check(['image', 'inspect', '--format', '{{.Id}}', image])
      if (result.outcome === 'ok') return true
      if (result.outcome === 'exit' && /No such image/i.test(result.stderr)) return false
      throw new DockerError(result.outcome === 'not_found' ? 'missing' : 'down')
    },
    containers,
    async memoryMb(id) {
      if (!ID_RE.test(id)) return null
      const result = await check(['stats', '--no-stream', '--format', '{{.MemUsage}}', id])
      return result.outcome === 'ok' ? parseMemUsage(result.stdout) : null
    },
    async removeContainers(bot) {
      const ids = (await containers(bot)).map(c => c.id)
      if (ids.length === 0) return 0
      const result = await check(['rm', '-f', ...ids])
      if (result.outcome !== 'ok') throw new DockerError('failed')
      return ids.length
    },
    async cleanupSandboxes(bot, sandboxesDir, image) {
      const result = await runner.run(cleanupArgs(bot, sandboxesDir, image), CLEANUP_TIMEOUT_MS)
      if (result.outcome !== 'ok') throw new DockerError('failed')
    }
  }
}
