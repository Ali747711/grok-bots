import { DockerError, InvalidImageError, isValidImage } from '../sandbox/docker.js'

import type { BotDeps } from './create.js'
import { type SandboxMarker, createPatch, effectiveImage, readMarker } from './sandbox-state.js'
import { type SandboxDeps, readRawConfig, writeConfig } from './sandbox.js'
import { readBotMeta } from './ui-meta.js'

const PRIMARY = 'default'

/**
 * A new bot is cloned from the primary, so it inherits the primary's sandbox. Write the dialog's choice
 * explicitly, reading the PRIMARY's marker (the clone has none yet). Returns the marker for the caller
 * to store with the look (R7); nothing is written to ui_meta here.
 */
export async function applyCreateSandbox(deps: BotDeps, bot: string, on: boolean): Promise<SandboxMarker> {
  const [raw, { meta }] = await Promise.all([readRawConfig(deps, bot), readBotMeta(deps.rpc, PRIMARY)])
  const patch = createPatch(raw, on, readMarker(meta))
  await writeConfig(deps, bot, patch.config)
  return patch.marker
}

/** Checked before `profiles.create`: the clone would run on the primary's image. */
export async function sandboxReadiness(deps: BotDeps, sb: SandboxDeps): Promise<'ok' | 'docker_unavailable' | 'image_missing'> {
  const image = effectiveImage(await readRawConfig(deps, PRIMARY))
  if (!isValidImage(image)) throw new InvalidImageError()
  if ((await sb.docker.status()) !== 'ok') return 'docker_unavailable'
  try {
    return (await sb.docker.imagePresent(image)) ? 'ok' : 'image_missing'
  } catch (error) {
    if (error instanceof DockerError) return 'docker_unavailable'
    throw error
  }
}
