import { CreateBotError } from '../bots/create.js'
import { NotSavedError, PrimaryBotError } from '../bots/edit.js'
import { SandboxCleanupError } from '../bots/sandbox-cleanup.js'
import { SandboxRefusedError } from '../bots/sandbox.js'
import { BotNotFoundError } from '../bots/ui-meta.js'
import { HermesRestError, HermesRpcError, HermesUnavailableError } from '../hermes/errors.js'
import { ScheduleError } from '../routines/schedule.js'
import { DockerError, InvalidImageError } from '../sandbox/docker.js'
import { log } from '../log.js'

export interface Failure {
  readonly status: 400 | 404 | 409 | 413 | 502 | 503
  readonly body: Record<string, unknown>
}

/** Hermes `profiles.set_asset` codes (F§2): too large, not base64, unsupported format, no such profile. */
function rpcFailure(error: HermesRpcError): Failure | null {
  if (error.code === 4069) return { status: 413, body: { error: 'too_large' } }
  if (error.code === 4068 || error.code === 4070) return { status: 400, body: { error: 'bad_image', message: error.message } }
  if (error.code === 4064) return { status: 404, body: { error: 'not_found' } }
  return null
}

/** Map anything a bot route can throw to an HTTP answer; never rethrows. Unexpected failures are logged. */
export function failure(error: unknown, name: string): Failure {
  if (error instanceof HermesUnavailableError) return { status: 503, body: { error: 'hermes_offline' } }
  if (error instanceof BotNotFoundError) return { status: 404, body: { error: 'not_found' } }
  if (error instanceof HermesRestError && error.status === 404) return { status: 404, body: { error: 'not_found' } }
  // Hermes refused the input (cron prompt scan, bad schedule): show its words verbatim.
  if (error instanceof HermesRestError && error.status === 400) return { status: 400, body: { error: 'rejected', message: error.detail } }
  if (error instanceof ScheduleError) return { status: 400, body: { error: error.code, message: error.message } }
  if (error instanceof PrimaryBotError) return { status: 400, body: { error: 'cannot_delete_primary' } }
  if (error instanceof SandboxCleanupError) {
    log.warn('sandbox cleanup failed', { bot: name, reason: error.reason })
    return { status: 409, body: { error: 'sandbox_cleanup_failed' } }
  }
  if (error instanceof SandboxRefusedError) return { status: 409, body: { error: error.code } }
  if (error instanceof InvalidImageError) return { status: 502, body: { error: 'bad_image_name' } }
  if (error instanceof DockerError) return { status: 503, body: { error: 'docker_unavailable' } }
  if (error instanceof NotSavedError) return { status: 502, body: { error: 'not_saved', section: error.section } }
  if (error instanceof CreateBotError) {
    return error.kind === 'name_taken' ? { status: 409, body: { error: 'name_taken' } } : { status: 400, body: { error: 'bad_name', message: error.message } }
  }
  if (error instanceof HermesRpcError) {
    const mapped = rpcFailure(error)
    if (mapped) return mapped
  }
  const message = error instanceof Error ? error.message : String(error)
  log.warn('bot request failed', { name, rpcCode: error instanceof HermesRpcError ? error.code : null, error: message.slice(0, 200) })
  return { status: 502, body: { error: 'hermes_error', message } }
}
