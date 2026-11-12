import { z } from 'zod'

import { withBotLock } from './bot-lock.js'
import type { BotDeps } from './create.js'
import { NotSavedError } from './edit.js'
import { readRawConfig, writeConfig } from './sandbox.js'
import { rawToolsetList, readMarker, sandboxStateOf } from './sandbox-state.js'
import { BotMetaWriteError, readBotMeta, updateBotMeta } from './ui-meta.js'

const TOOLSETS_PATH = '/api/tools/toolsets'

/** The switches Crew offers, in display order (facts Q2). */
export const OFFERED_TOOLSETS = [
  'web', 'browser', 'terminal', 'file', 'code_execution', 'vision', 'image_gen', 'tts', 'skills', 'todo',
  'memory', 'session_search', 'delegation', 'cronjob', 'computer_use'
] as const

/** Internal or platform-specific toolsets that never get a switch. */
export const HIDDEN_TOOLSETS: ReadonlySet<string> = new Set([
  'clarify', 'connections', 'stt', 'context_engine', 'kanban', 'video', 'video_gen', 'discord', 'discord_admin',
  'yuanbao', 'moa', 'crew_apps'
])

export interface ToolsetView {
  readonly name: string
  readonly label: string
  readonly description: string
  readonly enabled: boolean
  readonly needsSetup: boolean
  readonly locked?: 'sandbox'
}

export class ToolsetRefusedError extends Error {
  constructor(readonly code: 'unknown_toolset' | 'toolset_locked') {
    super(`toolset refused: ${code}`)
    this.name = 'ToolsetRefusedError'
  }
}

/** Hermes's toolset list did not have the shape Crew reads. Carries no detail: the parser's text is not for the user. */
export class ToolsetShapeError extends Error {
  constructor() {
    super('toolset list has an unexpected shape')
    this.name = 'ToolsetShapeError'
  }
}

const rowsSchema = z.array(z.object({
  name: z.string(),
  label: z.string().optional(),
  description: z.string().optional(),
  platform: z.string().optional(),
  enabled: z.boolean().optional(),
  configured: z.boolean().optional()
}).passthrough())
type Row = z.infer<typeof rowsSchema>[number]

const isOffered = (name: string): boolean => (OFFERED_TOOLSETS as readonly string[]).includes(name)
const onCli = (row: Row): boolean => row.platform === undefined || row.platform === 'cli'

/** Plugin rows (x_search, spotify…) show only while on, or after Crew turned them off, so they can come back. */
function isExtra(row: Row, turnedOff: readonly unknown[]): boolean {
  if (isOffered(row.name) || HIDDEN_TOOLSETS.has(row.name) || row.name.startsWith('mcp-') || !onCli(row)) return false
  return row.enabled === true || turnedOff.includes(row.name)
}

/** Turns the REST rows (`GET /api/tools/toolsets`) into the Skills switches. A bad shape throws `ToolsetShapeError` (502, no message). */
export function toolsetViews(rows: unknown, raw: unknown): readonly ToolsetView[] {
  const result = rowsSchema.safeParse(rows)
  if (!result.success) throw new ToolsetShapeError()
  const parsed = result.data.filter(onCli)
  const turnedOff = rawToolsetList(raw)
  const locked = sandboxStateOf(raw).state !== 'off'
  const picked = [
    ...OFFERED_TOOLSETS.flatMap(name => parsed.find(row => row.name === name) ?? []),
    ...parsed.filter(row => isExtra(row, turnedOff))
  ]
  return picked.map(row => ({
    name: row.name,
    label: row.label ?? '',
    description: row.description ?? '',
    enabled: row.enabled === true,
    needsSetup: row.configured === false,
    ...(row.name === 'browser' && locked ? { locked: 'sandbox' as const } : {})
  }))
}

async function viewsFor(deps: BotDeps, name: string, raw: unknown): Promise<readonly ToolsetView[]> {
  const rows = await deps.rest.request<unknown>('GET', TOOLSETS_PATH, { query: { profile: name } })
  return toolsetViews(rows, raw)
}

export async function readToolsets(deps: BotDeps, name: string): Promise<readonly ToolsetView[]> {
  return viewsFor(deps, name, await readRawConfig(deps, name))
}

/** R1: the user now owns the `browser` entry, so a sandbox-off must not strip it later. */
async function claimBrowser(deps: BotDeps, name: string): Promise<void> {
  try {
    const { meta } = await readBotMeta(deps.rpc, name)
    const marker = readMarker(meta)
    if (marker.addedBrowserDisable) await updateBotMeta(deps.rpc, name, { sandbox: { ...marker, addedBrowserDisable: false } })
  } catch (error) {
    if (error instanceof BotMetaWriteError) throw new NotSavedError('ui_meta')
    throw error
  }
}

async function turnOn(deps: BotDeps, name: string, toolset: string, raw: unknown): Promise<void> {
  const list = rawToolsetList(raw).map(String)
  if (list.includes(toolset)) await writeConfig(deps, name, { agent: { disabled_toolsets: list.filter(x => x !== toolset) } })
  const fresh = await readRawConfig(deps, name)
  // Hermes's own Toolsets tab keeps its own list (platform_toolsets.cli); enable through its route if still off.
  if (!(await viewsFor(deps, name, fresh)).find(v => v.name === toolset)?.enabled) {
    await deps.rest.request('PUT', `${TOOLSETS_PATH}/${encodeURIComponent(toolset)}`, { body: { enabled: true, profile: name } })
  }
}

export function setToolset(deps: BotDeps, name: string, toolset: string, enabled: boolean): Promise<readonly ToolsetView[]> {
  return withBotLock(name, async () => {
    const raw = await readRawConfig(deps, name)
    const current = (await viewsFor(deps, name, raw)).find(v => v.name === toolset)
    if (!current) throw new ToolsetRefusedError('unknown_toolset')
    if (current.locked) throw new ToolsetRefusedError('toolset_locked')
    if (enabled) {
      await turnOn(deps, name, toolset, raw)
    } else {
      const list = rawToolsetList(raw).map(String)
      if (!list.includes(toolset)) await writeConfig(deps, name, { agent: { disabled_toolsets: [...list, toolset] } })
    }
    if (toolset === 'browser') await claimBrowser(deps, name)
    deps.voice?.changed(name)
    return readToolsets(deps, name)
  })
}
