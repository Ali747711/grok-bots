import { CrewApiError } from './bots-api'

export interface CreateFailure {
  /** Shown under the handle field. */
  readonly handle?: string
  /** Shown as a general error. */
  readonly general?: string
}

const TIMEOUT_NOTE = "Hermes didn't answer. The bot may still have been created — check the list before trying again."

/** Words for what `POST /crew/bots` can answer with. */
export function describeCreateFailure(error: unknown): CreateFailure {
  if (!(error instanceof CrewApiError)) return { general: 'Could not reach Crew. Try again.' }
  const code = error.body?.error
  const message = typeof error.body?.message === 'string' ? error.body.message : null
  if (error.status === 409 && code === 'name_taken') return { handle: 'That handle is taken' }
  if (error.status === 409 && code === 'docker_unavailable') return { general: "Docker isn't available on this computer" }
  if (error.status === 409 && code === 'image_missing') return { general: "The sandbox image isn't downloaded" }
  if (error.status === 409) return { general: 'That bot is still being created. Wait a moment.' }
  if (error.status === 400 && code === 'bad_name') return { handle: message ?? 'Hermes does not accept that handle' }
  if (error.status === 413) return { general: 'That photo is too large' }
  if (error.status === 502) return { general: TIMEOUT_NOTE }
  if (error.status === 503) return { general: 'Hermes is offline' }
  return { general: 'Could not create the bot' }
}
