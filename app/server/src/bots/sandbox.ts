import type { GroupsState } from '../groups/types.js'
import { log } from '../log.js'
import { DockerError, type Docker, type DockerState, InvalidImageError, isValidImage } from '../sandbox/docker.js'
import type { ImagePuller } from '../sandbox/pull.js'

import { withBotLock } from './bot-lock.js'
import type { BotDeps } from './create.js'
import { refreshQuietly } from './refresh.js'
import { NotSavedError } from './edit.js'
import {
  type SandboxMarker, type SandboxPatch, type SandboxState, effectiveImage, offPatch, onPatch, readMarker, sandboxStateOf
} from './sandbox-state.js'
import { BotMetaWriteError, readBotMeta, updateBotMeta } from './ui-meta.js'

const CONFIG_PATH = '/api/config'

export interface SandboxDeps {
  readonly docker: Docker
  readonly puller: ImagePuller
  readonly hermesHome: string
  readonly groups: () => GroupsState
  /** Task 4 wires the roster cache's invalidate. */
  readonly onChanged?: (bot: string) => void
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

export class SandboxRefusedError extends Error {
  constructor(readonly code: 'docker_unavailable' | 'image_missing') {
    super(`sandbox refused: ${code}`)
    this.name = 'SandboxRefusedError'
  }
}

/** The RAW config (no defaults, no expanded secrets). The body is never logged. */
export async function readRawConfig(deps: Pick<BotDeps, 'rest'>, name: string): Promise<Record<string, unknown>> {
  const body = await deps.rest.request<unknown>('GET', CONFIG_PATH, { query: { profile: name, include_defaults: 'false' } })
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

/** Hermes deep-merges dicts but replaces arrays, so callers pass whole lists for array keys. */
export async function writeConfig(deps: Pick<BotDeps, 'rest'>, name: string, config: Record<string, unknown>): Promise<void> {
  await deps.rest.request('PUT', CONFIG_PATH, { query: { profile: name }, body: { config } })
}

export function groupsWithBot(groups: GroupsState, bot: string): SandboxView['groups'] {
  return groups.rooms
    .filter(room => room.members.some(member => member.profile === bot))
    .map(room => ({ id: room.id, name: room.name }))
}

async function probe(docker: Docker, status: DockerState, bot: string, image: string): Promise<
  Pick<SandboxView, 'docker' | 'imagePresent' | 'container'>
> {
  if (status !== 'ok') return { docker: status, imagePresent: false, container: null }
  try {
    const imagePresent = await docker.imagePresent(image)
    const found = await docker.containers(bot)
    const running = found.find(c => c.running)
    if (!running) return { docker: 'ok', imagePresent, container: found[0] ? { running: false, memMb: null } : null }
    return { docker: 'ok', imagePresent, container: { running: true, memMb: await docker.memoryMb(running.id) } }
  } catch (error) {
    if (error instanceof DockerError) return { docker: 'down', imagePresent: false, container: null }
    throw error
  }
}

export async function readSandbox(deps: BotDeps, sb: SandboxDeps, bot: string): Promise<SandboxView> {
  const [raw, { meta }, status] = await Promise.all([readRawConfig(deps, bot), readBotMeta(deps.rpc, bot), sb.docker.status()])
  const image = effectiveImage(raw)
  if (!isValidImage(image)) throw new InvalidImageError()
  const { state, reasons } = sandboxStateOf(raw)
  const checked = await probe(sb.docker, status, bot, image)
  return {
    state, reasons, image, ...checked,
    addedBrowserDisable: readMarker(meta).addedBrowserDisable,
    groups: groupsWithBot(sb.groups(), bot)
  }
}

async function writeMarker(deps: BotDeps, bot: string, marker: SandboxMarker): Promise<void> {
  try {
    await updateBotMeta(deps.rpc, bot, { sandbox: marker })
  } catch (error) {
    if (error instanceof BotMetaWriteError) throw new NotSavedError('ui_meta')
    throw error
  }
}

/** Best effort: the config already says `local`, so a leftover container is only a cost (R10). */
export async function removeQuietly(sb: SandboxDeps, bot: string): Promise<void> {
  try {
    await sb.docker.removeContainers(bot)
  } catch (error) {
    log.warn('sandbox container removal failed', { bot, kind: error instanceof DockerError ? error.kind : 'unknown' })
  }
}

async function assertCanTurnOn(sb: SandboxDeps, image: string): Promise<void> {
  if (!isValidImage(image)) throw new InvalidImageError()
  if ((await sb.docker.status()) !== 'ok') throw new SandboxRefusedError('docker_unavailable')
  try {
    if (!(await sb.docker.imagePresent(image))) throw new SandboxRefusedError('image_missing')
  } catch (error) {
    if (error instanceof DockerError) throw new SandboxRefusedError('docker_unavailable')
    throw error
  }
}

export function setSandbox(deps: BotDeps, sb: SandboxDeps, bot: string, on: boolean): Promise<SandboxView> {
  return withBotLock(bot, async () => {
    const [raw, { meta }] = await Promise.all([readRawConfig(deps, bot), readBotMeta(deps.rpc, bot)])
    const marker = readMarker(meta)
    if (on) await assertCanTurnOn(sb, effectiveImage(raw))
    const patch: SandboxPatch = on ? onPatch(raw, marker) : offPatch(raw, marker)
    await writeConfig(deps, bot, patch.config)
    try {
      await writeMarker(deps, bot, patch.marker)
    } finally {
      // Even after a failed marker write the config changed: drop caches so the UI re-reads Hermes.
      sb.onChanged?.(bot)
    }
    if (!on) await removeQuietly(sb, bot)
    await refreshQuietly(deps)
    deps.voice?.changed(bot)
    return readSandbox(deps, sb, bot)
  })
}

export function resetSandbox(deps: BotDeps, sb: SandboxDeps, bot: string): Promise<SandboxView> {
  return withBotLock(bot, async () => {
    if ((await sb.docker.status()) !== 'ok') throw new SandboxRefusedError('docker_unavailable')
    try {
      await sb.docker.removeContainers(bot)
    } catch (error) {
      if (error instanceof DockerError) throw new SandboxRefusedError('docker_unavailable')
      throw error
    }
    sb.onChanged?.(bot)
    return readSandbox(deps, sb, bot)
  })
}
