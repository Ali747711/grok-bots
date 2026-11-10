import { CrewApiError, crewJson } from '@/lib/crew-json'

import type { ImageStatus, PullError, PullProgress, SandboxView } from './sandbox-types'

const botPath = (bot: string, action = '') => `/crew/bots/${encodeURIComponent(bot)}/sandbox${action}`

export const getSandbox = (bot: string) => crewJson<SandboxView>(botPath(bot), 'GET')
export const setSandbox = (bot: string, on: boolean) => crewJson<SandboxView>(botPath(bot), 'PUT', { on })
export const resetSandbox = (bot: string) => crewJson<SandboxView>(botPath(bot, '/reset'), 'POST')
export const getImage = () => crewJson<ImageStatus>('/crew/sandbox/image', 'GET')
/** 202 while a download runs, 200 when the image is already there: both carry the status. */
export const pullImage = () => crewJson<ImageStatus>('/crew/sandbox/image/pull', 'POST', undefined, [202])

const codeOf = (e: unknown): string | undefined => {
  const code = e instanceof CrewApiError ? e.body?.error : undefined
  return typeof code === 'string' ? code : undefined
}
const statusOf = (e: unknown): number | undefined => (e instanceof CrewApiError ? e.status : undefined)

/** Why a switch or reset failed. */
export function sandboxErrorText(e: unknown): string {
  const code = codeOf(e)
  if (code === 'docker_unavailable') return "Docker isn't available on this computer"
  if (code === 'image_missing') return "The sandbox image isn't downloaded"
  if (statusOf(e) === 503) return 'Hermes is offline'
  return "Couldn't change the sandbox. Try again."
}

/** The reason after "Couldn't check the sandbox:". */
export function checkReason(e: unknown): string {
  if (statusOf(e) === 503) return 'Hermes is offline'
  if (statusOf(e) === 502 && codeOf(e) === 'bad_image_name') return "the image name in this bot's settings isn't valid"
  return "Hermes didn't answer"
}

export const PULL_ERROR_TEXT: Record<PullError, string> = {
  no_space: "There isn't enough disk space for the sandbox image.",
  network: "Couldn't reach Docker Hub. Check the internet connection.",
  failed: 'The download stopped.'
}

const mb = (n: number) => Math.round(n / 1e6)

export function progressText(p: PullProgress | null): string {
  if (p && p.bytesDone !== null && p.bytesTotal !== null) return `Downloading… ${mb(p.bytesDone)} MB of ${mb(p.bytesTotal)} MB`
  if (p && p.layersTotal > 0) return `Downloading… ${p.layersDone} of ${p.layersTotal} parts`
  return 'Starting the download…'
}
