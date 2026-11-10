import { type IdleStopMinutes, ScreenApiError } from '@/lib/crew-api'
import { CrewApiError, crewJson } from '@/lib/crew-json'

// Copies of the server shapes (bots/approvals.ts); the web never imports server code.
export type ApprovalMode = 'manual' | 'smart' | 'off'

export interface ApprovalsView {
  /** The mode in effect: an unset key reads as Hermes's default, `smart`. */
  readonly mode: ApprovalMode
  /** True when nothing is written and Hermes's default applies. */
  readonly isDefault: boolean
  /** True only when the bot's sandbox is fully on. */
  readonly sandboxed: boolean
}

const approvalsPath = (name: string) => `/crew/bots/${encodeURIComponent(name)}/approvals`

export const getApprovals = (name: string) => crewJson<ApprovalsView>(approvalsPath(name), 'GET')
export const setApprovals = (name: string, mode: ApprovalMode) => crewJson<ApprovalsView>(approvalsPath(name), 'PUT', { mode })

const GENERIC = "Couldn't save. Try again."
/** The codes whose `message` is Hermes's own words. A Crew validation message (`bad_body`) is never shown. */
const HERMES_WORDS: readonly string[] = ['hermes_error', 'rejected']

interface Refusal {
  readonly status: number
  readonly code: string | null
  readonly message: string | null
}

function refusalOf(e: unknown): Refusal | null {
  if (e instanceof ScreenApiError) return { status: e.status, code: e.code, message: e.message }
  if (!(e instanceof CrewApiError)) return null
  const { error, message } = e.body ?? {}
  return { status: e.status, code: typeof error === 'string' ? error : null, message: typeof message === 'string' ? message : null }
}

/**
 * The one sentence a failed immediate-apply row shows (PF21): Hermes's own words when it sent them,
 * a plain reason for the codes Crew knows, and never a raw code.
 */
export function profileErrorText(e: unknown, title?: string): string {
  const refusal = refusalOf(e)
  if (!refusal) return GENERIC
  if (refusal.status === 503) return 'Hermes is offline'
  if (refusal.code === 'primary_not_supported') return 'Change this in Hermes for the primary bot'
  if (refusal.code === 'toolset_locked') return `Off while ${title ?? 'the bot'} runs in a sandbox`
  if (refusal.code !== null && HERMES_WORDS.includes(refusal.code) && refusal.message) return refusal.message
  return GENERIC
}

/** Why a setting could not be read, to follow "Couldn't read this setting:". */
export function profileReadErrorText(e: unknown): string {
  const refusal = refusalOf(e)
  if (refusal?.status === 503) return 'Hermes is offline'
  // A screen route's message is already readable text, never a raw code.
  if (e instanceof ScreenApiError) return e.message
  if (refusal && refusal.code !== null && HERMES_WORDS.includes(refusal.code) && refusal.message) return refusal.message
  return "Hermes didn't answer"
}

/** The sleep choice shown for a stored value (R3): 60 and 0 as they are, anything else as 15, which Crew writes at the next start. */
export function sleepChoice(raw: number | null): IdleStopMinutes {
  return raw === 60 || raw === 0 ? raw : 15
}

export const SLEEP_LABEL: Readonly<Record<IdleStopMinutes, string>> = { 15: '15 min', 60: '1 hour', 0: 'Never' }
