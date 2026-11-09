import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { log } from '../log.js'

export interface UsageView {
  readonly state: 'ok' | 'stale' | 'unavailable'
  readonly limit: number | null
  readonly used: number | null
  readonly remaining: number | null
  readonly checkedAt: number | null
}

export interface UsageSource {
  get(): Promise<UsageView>
}

export interface UsageDeps {
  readonly envFile: string
  readonly fetch: typeof fetch
  readonly now: () => number
}

const KEY_URL = 'https://openrouter.ai/api/v1/key'
const CACHE_MS = 60_000
const TIMEOUT_MS = 10_000
const KEY_NAME = 'OPENROUTER_API_KEY'

const keyReply = z.object({
  data: z.object({
    limit: z.number().nullable(),
    usage: z.number(),
    limit_remaining: z.number().nullable()
  })
})

/** Value of `name` in dotenv-style text: `KEY=value`, optional `export`, optional quotes, `#` comments. */
export function parseEnvKey(text: string, name: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim().replace(/^export\s+/, '')
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0 || line.slice(0, eq).trim() !== name) continue
    const value = line.slice(eq + 1).trim().replace(/^(["'])(.*)\1$/, '$2')
    return value || null
  }
  return null
}

const unavailable: UsageView = { state: 'unavailable', limit: null, used: null, remaining: null, checkedAt: null }

/**
 * OpenRouter credit, cached for 60 s. The key is read from the env file on every refresh (so rotation
 * is picked up) and never leaves this module: failures are logged by class only, never by message.
 */
export function createUsageSource(deps: UsageDeps): UsageSource {
  let last: UsageView | null = null
  let attemptedAt = -Infinity
  let inflight: Promise<UsageView> | null = null

  async function fetchOnce(): Promise<UsageView> {
    const key = parseEnvKey(await readFile(deps.envFile, 'utf8'), KEY_NAME)
    if (!key) throw new Error('no_key')
    const res = await deps.fetch(KEY_URL, {
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
    if (!res.ok) throw new Error(`http_${res.status}`)
    const { data } = keyReply.parse(await res.json())
    return { state: 'ok', limit: data.limit, used: data.usage, remaining: data.limit_remaining, checkedAt: deps.now() }
  }

  async function refresh(): Promise<UsageView> {
    attemptedAt = deps.now()
    try {
      last = await fetchOnce()
      return last
    } catch (error) {
      // Class only: a message from fetch or a parse error could echo request details.
      log.warn('openrouter usage refresh failed', { error: error instanceof Error ? error.name : 'Error' })
      // Store the stale view so cached reads in this window don't serve the old figures as ok.
      last = last ? { ...last, state: 'stale' } : null
      return last ?? unavailable
    }
  }

  return {
    async get() {
      if (deps.now() - attemptedAt < CACHE_MS) return last ?? unavailable
      inflight ??= refresh().finally(() => {
        inflight = null
      })
      return inflight
    }
  }
}
