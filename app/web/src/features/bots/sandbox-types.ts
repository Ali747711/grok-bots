// Copies of the server's shapes (app/server/src/bots/sandbox*.ts, sandbox/docker.ts, sandbox/pull.ts). Never import from the server.
/** Copy of the server's managed image (sandbox/docker.ts DEFAULT_IMAGE). */
export const DEFAULT_IMAGE = 'nousresearch/hermes-sandbox:desktop'

export type SandboxState = 'off' | 'on' | 'partial'
export type DockerState = 'ok' | 'missing' | 'down'
export type PullError = 'no_space' | 'network' | 'failed'

export interface PullProgress {
  readonly layersDone: number
  readonly layersTotal: number
  readonly bytesDone: number | null
  readonly bytesTotal: number | null
}

export interface SandboxView {
  readonly state: SandboxState
  readonly reasons: readonly string[]
  readonly image: string
  readonly docker: DockerState
  readonly imagePresent: boolean
  readonly container: { readonly running: boolean; readonly memMb: number | null } | null
  readonly addedBrowserDisable: boolean
  readonly groups: readonly { readonly id: string; readonly name: string }[]
}

export interface ImageStatus {
  readonly pulling: boolean
  readonly progress: PullProgress | null
  readonly error: PullError | null
  readonly image: string
  readonly docker: DockerState
  readonly present: boolean
}
