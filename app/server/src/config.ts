import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { z } from 'zod'

/** Runtime settings for the Crew server. All network endpoints are loopback-only by design. */
export interface CrewConfig {
  readonly host: string
  readonly port: number
  readonly hermesUrl: string
  readonly hermesTokenFile: string
  readonly stateDir: string
  /** Hermes dotenv file; only the OpenRouter key is read from it (credit pill). */
  readonly hermesEnvFile: string
  /** Directory with the built web app (`index.html`, `assets/`). */
  readonly webDist: string
  readonly allowedHosts: readonly string[]
  readonly allowedOrigins: readonly string[]
}

const LOOPBACK = '127.0.0.1'
const DEFAULT_PORT = 7070
const DEFAULT_HERMES_URL = 'http://127.0.0.1:9120'

const envSchema = z.object({
  HOME: z.string().min(1, 'HOME must be set'),
  CREW_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  CREW_HERMES_URL: z.url().optional(),
  CREW_STATE_DIR: z.string().min(1).optional(),
  CREW_HERMES_TOKEN_FILE: z.string().min(1).optional(),
  CREW_HERMES_ENV_FILE: z.string().min(1).optional(),
  CREW_WEB_DIST: z.string().min(1).optional()
})

// This file lives in app/server/{src,dist}, so app/web/dist is two levels up.
const DEFAULT_WEB_DIST = resolve(dirname(fileURLToPath(import.meta.url)), '../../web/dist')

function expandHome(path: string, home: string): string {
  return path === '~' || path.startsWith('~/') ? join(home, path.slice(1)) : path
}

/** Build the config from the environment; throws on invalid values so the service fails fast. */
export function loadConfig(env: NodeJS.ProcessEnv): CrewConfig {
  const parsed = envSchema.parse(env)
  const home = parsed.HOME
  const port = parsed.CREW_PORT ?? DEFAULT_PORT
  const hosts = [`${LOOPBACK}:${port}`, `localhost:${port}`]

  return {
    host: LOOPBACK,
    port,
    hermesUrl: parsed.CREW_HERMES_URL ?? DEFAULT_HERMES_URL,
    hermesTokenFile: expandHome(parsed.CREW_HERMES_TOKEN_FILE ?? '~/.hermes/webapp/session-token', home),
    hermesEnvFile: expandHome(parsed.CREW_HERMES_ENV_FILE ?? '~/.hermes/.env', home),
    stateDir: expandHome(parsed.CREW_STATE_DIR ?? '~/.config/crew', home),
    webDist: expandHome(parsed.CREW_WEB_DIST ?? DEFAULT_WEB_DIST, home),
    allowedHosts: hosts,
    allowedOrigins: hosts.map(h => `http://${h}`)
  }
}
