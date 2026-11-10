import { withBotLock } from './bot-lock.js'
import type { BotDeps } from './create.js'
import { readRawConfig, writeConfig } from './sandbox.js'
import { sandboxStateOf } from './sandbox-state.js'

export const APPROVAL_MODES = ['manual', 'smart', 'off'] as const
export type ApprovalMode = (typeof APPROVAL_MODES)[number]

export interface ApprovalsView {
  readonly mode: ApprovalMode
  readonly isDefault: boolean
  readonly sandboxed: boolean
}

const section = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/**
 * Normalizes the raw `approvals.mode` the way Hermes does (facts Q4): absent is `smart`, YAML false is
 * `off`, true is `manual`, a string matches case-insensitively, anything else falls back to `manual`.
 */
function normalize(mode: unknown): ApprovalMode {
  if (mode === false) return 'off'
  if (typeof mode !== 'string') return 'manual'
  const text = mode.trim().toLowerCase()
  return (APPROVAL_MODES as readonly string[]).includes(text) ? (text as ApprovalMode) : 'manual'
}

export function approvalsViewOf(raw: unknown): ApprovalsView {
  const mode = section(section(raw).approvals).mode
  return {
    mode: mode === undefined || mode === null ? 'smart' : normalize(mode),
    isDefault: mode === undefined || mode === null,
    sandboxed: sandboxStateOf(raw).state === 'on'
  }
}

export async function readApprovals(deps: BotDeps, name: string): Promise<ApprovalsView> {
  return approvalsViewOf(await readRawConfig(deps, name))
}

/** Writes a sparse `{approvals: {mode}}`; `off` also asks the apps to clamp using the fresh config. */
export function setApprovals(deps: BotDeps, name: string, mode: ApprovalMode): Promise<ApprovalsView> {
  return withBotLock(name, async () => {
    await writeConfig(deps, name, { approvals: { mode } })
    const fresh = await readRawConfig(deps, name)
    if (mode === 'off') deps.apps?.clamp?.(name, fresh)
    return approvalsViewOf(fresh)
  })
}
