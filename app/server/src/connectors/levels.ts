import type { ToolHint } from './composio.js'
import { OFFERED_LEVELS } from './policy.js'

export type AppLevel = 'read' | 'change' | 'all'
export const APP_LEVELS: readonly AppLevel[] = ['read', 'change', 'all']
export const TOOLKIT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/

export interface AllowList {
  readonly allowed: readonly string[]
  readonly byApp: Readonly<Record<string, { readonly tools: number; readonly capped: boolean }>>
}

/** Slugs a level lets through: read-only tools first, then the given order (a stable partition). */
export function allowedSlugs(tools: readonly ToolHint[], level: AppLevel): readonly string[] {
  const keep = tools.filter(t => level === 'all' || t.readOnly || (level === 'change' && !t.destructive))
  return [...keep.filter(t => t.readOnly), ...keep.filter(t => !t.readOnly)].map(t => t.slug)
}

/** Every app's allowed tools, in app-slug order, until `cap` is reached; the app cut short is `capped`. */
export function allowList(
  apps: Readonly<Record<string, AppLevel>>,
  toolsOf: (toolkit: string) => readonly ToolHint[],
  cap: number | null
): AllowList {
  const allowed: string[] = []
  const byApp: Record<string, { tools: number; capped: boolean }> = {}
  for (const toolkit of Object.keys(apps).sort()) {
    const slugs = allowedSlugs(toolsOf(toolkit), apps[toolkit] as AppLevel)
    const room = cap === null ? slugs.length : Math.max(0, cap - allowed.length)
    const kept = slugs.slice(0, room)
    allowed.push(...kept)
    byApp[toolkit] = { tools: kept.length, capped: kept.length < slugs.length }
  }
  return { allowed, byApp }
}

/** R9: approvals are off when `approvals.mode` is YAML false or "off" in any case (Hermes normalizes it so). */
export function approvalsAsk(raw: unknown): boolean {
  if (raw === false) return false
  return !(typeof raw === 'string' && raw.trim().toLowerCase() === 'off')
}

/** A bot that does not ask before actions can only read; the policy narrows the rest. */
export function offeredLevels(asks: boolean, policy: readonly AppLevel[] = OFFERED_LEVELS): readonly AppLevel[] {
  return policy.filter(level => asks || level === 'read')
}
