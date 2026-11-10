import { log } from '../log.js'

import { DEFAULT_IMAGE, type Docker, type DockerRunner, type DockerState, type RunResult } from './docker.js'

export const PULL_TIMEOUT_MS = 3_600_000

type Bytes = { readonly done: number; readonly total: number }

export interface PullTally {
  readonly layers: ReadonlyMap<string, 'pending' | 'done'>
  readonly bytes: ReadonlyMap<string, Bytes>
}

export const EMPTY_TALLY: PullTally = { layers: new Map(), bytes: new Map() }

const LINE_RE =
  /^([0-9a-f]{12,64}): (Pulling fs layer|Waiting|Downloading|Verifying Checksum|Download complete|Extracting|Pull complete|Already exists)/
const SIZES_RE = /([0-9]+(?:\.[0-9]+)?)\s?(B|kB|MB|GB)\s*\/\s*([0-9]+(?:\.[0-9]+)?)\s?(B|kB|MB|GB)/
const UNIT: Record<string, number> = { B: 1, kB: 1e3, MB: 1e6, GB: 1e9 }

/** Folds one `docker pull` output line into the tally; returns the same object for lines it ignores. */
export function parsePullLine(tally: PullTally, line: string): PullTally {
  const match = LINE_RE.exec(line)
  if (!match) return tally
  const id = match[1] ?? ''
  const phase = match[2]
  const layers = new Map(tally.layers)
  const bytes = new Map(tally.bytes)
  const finished = phase === 'Already exists' || phase === 'Pull complete'
  layers.set(id, finished ? 'done' : (layers.get(id) ?? 'pending'))
  const sizes = SIZES_RE.exec(line)
  if (sizes) {
    const total = Number(sizes[3]) * (UNIT[sizes[4] ?? 'B'] ?? 1)
    bytes.set(id, { done: Number(sizes[1]) * (UNIT[sizes[2] ?? 'B'] ?? 1), total })
  }
  const known = bytes.get(id)
  if (finished && known) bytes.set(id, { done: known.total, total: known.total })
  return { layers, bytes }
}

export interface PullProgress {
  readonly layersDone: number
  readonly layersTotal: number
  readonly bytesDone: number | null
  readonly bytesTotal: number | null
}

export function progressOf(tally: PullTally): PullProgress {
  let layersDone = 0
  for (const state of tally.layers.values()) if (state === 'done') layersDone += 1
  let bytesDone = 0
  let bytesTotal = 0
  for (const entry of tally.bytes.values()) {
    bytesDone += entry.done
    bytesTotal += entry.total
  }
  const hasBytes = tally.bytes.size > 0
  return {
    layersDone,
    layersTotal: tally.layers.size,
    bytesDone: hasBytes ? Math.round(bytesDone) : null,
    bytesTotal: hasBytes ? Math.round(bytesTotal) : null
  }
}

export type PullError = 'no_space' | 'network' | 'failed'

export function pullErrorOf(result: RunResult): PullError {
  if (result.outcome === 'timeout') return 'failed'
  if (/no space left on device/i.test(result.stderr)) return 'no_space'
  if (/dial tcp|no such host|i\/o timeout|connection refused|TLS handshake|network is unreachable/i.test(result.stderr)) return 'network'
  return 'failed'
}

export interface PullState {
  readonly pulling: boolean
  readonly progress: PullProgress | null
  readonly error: PullError | null
}

export interface ImagePuller {
  state(): PullState
  start(): 'started' | 'running'
}

/** One `docker pull` at a time. Docker's output is parsed for progress, never stored or logged. */
export function createImagePuller(runner: DockerRunner, image: string = DEFAULT_IMAGE): ImagePuller {
  let pulling = false
  let tally: PullTally = EMPTY_TALLY
  let error: PullError | null = null
  return {
    state: () => ({ pulling, progress: pulling ? progressOf(tally) : null, error }),
    start() {
      if (pulling) return 'running'
      pulling = true
      tally = EMPTY_TALLY
      error = null
      void runner
        .stream(['pull', image], PULL_TIMEOUT_MS, line => { tally = parsePullLine(tally, line) })
        .then(result => {
          if (result.outcome === 'ok') return
          error = pullErrorOf(result)
          log.warn('sandbox image pull failed', { error })
        })
        .finally(() => { pulling = false })
      return 'started'
    }
  }
}

export type ImageStatus = PullState & { readonly image: string; readonly docker: DockerState; readonly present: boolean }

export async function imageStatus(docker: Docker, puller: ImagePuller): Promise<ImageStatus> {
  const state = await docker.status()
  const present = state === 'ok' ? await docker.imagePresent(DEFAULT_IMAGE) : false
  return { ...puller.state(), image: DEFAULT_IMAGE, docker: state, present }
}
