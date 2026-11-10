import { lstat } from 'node:fs/promises'
import { join } from 'node:path'

import { log } from '../log.js'
import { DockerError, isValidImage } from '../sandbox/docker.js'

import type { BotDeps } from './create.js'
import { type SandboxDeps, readRawConfig } from './sandbox.js'
import { effectiveImage } from './sandbox-state.js'

export type SandboxCleanupReason = 'docker_unavailable' | 'containers_not_removed' | 'image_missing' | 'helper_failed' | 'unreadable'

/** The message names a reason only: never a path or docker output. */
export class SandboxCleanupError extends Error {
  constructor(readonly reason: SandboxCleanupReason) {
    super(`sandbox cleanup failed: ${reason}`)
    this.name = 'SandboxCleanupError'
  }
}

export function sandboxesDirOf(hermesHome: string, bot: string): string {
  return join(hermesHome, 'profiles', bot, 'sandboxes')
}

async function isRealDirectory(path: string): Promise<boolean> {
  try {
    const info = await lstat(path)
    return info.isDirectory() && !info.isSymbolicLink()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT' || code === 'ENOTDIR') return false
    throw new SandboxCleanupError('unreadable')
  }
}

/** True only when `sandboxes` and `sandboxes/docker` are both real folders; a symlink never counts (R4). */
export async function hasDockerSandboxDir(sandboxesDir: string): Promise<boolean> {
  return (await isRealDirectory(sandboxesDir)) && (await isRealDirectory(join(sandboxesDir, 'docker')))
}

async function removeContainers(sb: SandboxDeps, bot: string): Promise<void> {
  try {
    await sb.docker.removeContainers(bot)
  } catch (error) {
    if (error instanceof DockerError) throw new SandboxCleanupError('containers_not_removed')
    throw error
  }
}

async function runHelper(deps: BotDeps, sb: SandboxDeps, bot: string, dir: string): Promise<void> {
  const image = effectiveImage(await readRawConfig(deps, bot))
  if (!isValidImage(image)) throw new SandboxCleanupError('image_missing')
  try {
    // No implicit pull (R5): `docker run` would download the image unasked.
    if (!(await sb.docker.imagePresent(image))) throw new SandboxCleanupError('image_missing')
    await sb.docker.cleanupSandboxes(bot, dir, image)
  } catch (error) {
    if (error instanceof SandboxCleanupError) throw error
    if (error instanceof DockerError) throw new SandboxCleanupError('helper_failed')
    throw error
  }
}

/**
 * Before Hermes deletes a profile, clear what Docker left behind: remove the containers, then
 * delete the root-owned mount-point folders with a root helper (§11.6). The helper only runs when
 * `sandboxes/docker` exists as a real folder, whatever the bot's config says now (R3, R4).
 * Answers true when Docker was reachable.
 */
export async function cleanupBeforeDelete(deps: BotDeps, sb: SandboxDeps, bot: string): Promise<boolean> {
  const dir = sandboxesDirOf(sb.hermesHome, bot)
  const status = await sb.docker.status()
  if (status !== 'ok') {
    if (await hasDockerSandboxDir(dir)) throw new SandboxCleanupError('docker_unavailable')
    log.info('sandbox cleanup skipped', { bot, docker: status })
    return false
  }
  await removeContainers(sb, bot)
  if (await hasDockerSandboxDir(dir)) await runHelper(deps, sb, bot, dir)
  return true
}
