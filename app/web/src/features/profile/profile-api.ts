import { appsReason } from '@/features/apps/apps-api'
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

// Copy of the server's `ToolsetView` (bots/toolsets.ts): one Hermes toolset as a skill switch.
export interface ToolsetView {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly enabled: boolean
  /** The provider keys the toolset needs are missing in Hermes. */
  readonly needsSetup: boolean
  /** Forced off, and why. Only `browser` while the bot runs in a sandbox. */
  readonly locked?: 'sandbox'
}

const toolsetsPath = (name: string) => `/crew/bots/${encodeURIComponent(name)}/toolsets`

export const getToolsets = (name: string) => crewJson<readonly ToolsetView[]>(toolsetsPath(name), 'GET')
/** Turns one toolset on or off; answers with every row as Hermes now has it. */
export const setToolset = (name: string, toolset: string, enabled: boolean) =>
  crewJson<readonly ToolsetView[]>(toolsetsPath(name), 'PUT', { name: toolset, enabled })

/** PF22: the one wording for a toolset the sandbox holds off. */
export const sandboxLockText = (title: string): string => `Off while ${title} runs in a sandbox`

const GENERIC = "Couldn't save. Try again."
const NO_ANSWER = "Hermes didn't answer"
/** The codes whose `message` is Hermes's own words. A Crew validation message (`bad_body`) is never shown. */
const HERMES_WORDS: readonly string[] = ['hermes_error', 'rejected']

interface Refusal {
  readonly status: number
  readonly code: string | null
  readonly message: string | null
  /** The message is already a plain sentence (the screen routes), never a raw code. */
  readonly plain: boolean
}

function refusalOf(e: unknown): Refusal | null {
  if (e instanceof ScreenApiError) return { status: e.status, code: e.code, message: e.message, plain: true }
  if (!(e instanceof CrewApiError)) return null
  const { error, message } = e.body ?? {}
  return { status: e.status, code: typeof error === 'string' ? error : null, message: typeof message === 'string' ? message : null, plain: false }
}

interface ErrorTextOptions {
  /** The bot's title, for the sentences that name it. */
  readonly title?: string
  /** The failure was a read: the sentence follows "Couldn't read this setting:" and never says "save". */
  readonly read?: boolean
}

/**
 * The one sentence for a failed profile write or read (PF21): Hermes's own words when it sent them,
 * a plain reason for the codes Crew knows, and never a raw code.
 */
export function profileErrorText(e: unknown, { title, read = false }: ErrorTextOptions = {}): string {
  const fallback = read ? NO_ANSWER : GENERIC
  const refusal = refusalOf(e)
  if (!refusal) return fallback
  // The apps routes' own refusals (the Apps tab's rows), said as everywhere else in Crew.
  const apps = appsReason(refusal.code)
  if (apps) return apps
  if (refusal.status === 503) return 'Hermes is offline'
  if (refusal.code === 'primary_not_supported') return 'Change this in Hermes for the primary bot'
  if (refusal.code === 'toolset_locked') return sandboxLockText(title ?? 'the bot')
  if (refusal.code !== null && HERMES_WORDS.includes(refusal.code) && refusal.message) return refusal.message
  if (read && refusal.plain && refusal.message) return refusal.message
  return fallback
}

/** The sleep choice shown for a stored value (R3): 60 and 0 as they are, anything else as 15, which Crew writes at the next start. */
export function sleepChoice(raw: number | null): IdleStopMinutes {
  return raw === 60 || raw === 0 ? raw : 15
}

export const SLEEP_LABEL: Readonly<Record<IdleStopMinutes, string>> = { 15: '15 min', 60: '1 hour', 0: 'Never' }
