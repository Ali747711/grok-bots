import type { BotDeps } from './create.js'

const CONFIG_PATH = '/api/config'
export const IDLE_STOP_CHOICES = [15, 60, 0] as const
export type IdleStopMinutes = (typeof IDLE_STOP_CHOICES)[number]
export const DEFAULT_IDLE_STOP: IdleStopMinutes = 15

export interface ScreenConfig {
  readonly idleStopMinutes: number | null
  readonly headed: boolean
  readonly autoStart: boolean
}

type Section = Record<string, unknown>
const section = (value: unknown): Section => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Section) : {})

/**
 * The three screen keys of one bot, from the RAW config (`include_defaults=false`: Hermes's
 * `read_raw_config`, no defaults and no expanded secrets, config_env.py get_config). An absent key
 * is Hermes's default: idle stop not set, headed and auto_start false. The body is never logged.
 */
export async function readScreenConfig(deps: BotDeps, name: string): Promise<ScreenConfig> {
  const body = await deps.rest.request<unknown>('GET', CONFIG_PATH, { query: { profile: name, include_defaults: 'false' } })
  const root = section(body)
  const desktop = section(root.bot_desktop)
  const idle = desktop.idle_stop_minutes
  return {
    idleStopMinutes: typeof idle === 'number' && Number.isFinite(idle) ? idle : null,
    headed: section(root.browser).headed === true,
    autoStart: desktop.auto_start === true
  }
}

/** Hermes deep-merges a PUT over the file (facts 5), so every write here is a sparse body. */
const writeSparse = (deps: BotDeps, name: string, config: Section): Promise<unknown> =>
  deps.rest.request('PUT', CONFIG_PATH, { query: { profile: name }, body: { config } })

/** Keep a 15, 60 or 0 (never) choice; anything else (unset, Hermes's 30) becomes 15. The caller holds the bot lock. */
export async function ensureIdleStop(deps: BotDeps, name: string): Promise<void> {
  const { idleStopMinutes } = await readScreenConfig(deps, name)
  if (idleStopMinutes !== null && (IDLE_STOP_CHOICES as readonly number[]).includes(idleStopMinutes)) return
  await setIdleStop(deps, name, DEFAULT_IDLE_STOP)
}

export async function setIdleStop(deps: BotDeps, name: string, minutes: IdleStopMinutes): Promise<void> {
  await writeSparse(deps, name, { bot_desktop: { idle_stop_minutes: minutes } })
}

/** Turn the bot's own browsing on the screen on or off: `headed` and `auto_start` always move together. */
export async function setUseScreen(deps: BotDeps, name: string, on: boolean): Promise<void> {
  // Idle stop first: if it fails, auto_start must not be left on with Hermes's 30-minute default.
  await ensureIdleStop(deps, name)
  await writeSparse(deps, name, { browser: { headed: on }, bot_desktop: { auto_start: on } })
}
