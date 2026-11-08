const CSRF_COOKIE = 'crew_csrf'
const CSRF_HEADER = 'X-Crew-CSRF'
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

function readCookie(name: string): string | null {
  for (const part of document.cookie.split('; ')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1))
  }
  return null
}

/**
 * Same-origin fetch to the Crew server. Adds the CSRF header on mutating
 * requests and sends the user to /login when the session is gone.
 */
export async function crewFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  const method = (init.method ?? 'GET').toUpperCase()
  if (!SAFE_METHODS.has(method)) {
    const token = readCookie(CSRF_COOKIE)
    if (token) headers.set(CSRF_HEADER, token)
  }
  const res = await fetch(path, { ...init, headers, credentials: 'same-origin' })
  if (res.status === 401) location.href = '/login'
  return res
}

/** A non-2xx answer from a screen route; `message` is Hermes's own words when the server passes them on. */
export class ScreenApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    message: string
  ) {
    super(message)
    this.name = 'ScreenApiError'
  }
}

export interface ScreenConfigView {
  readonly useScreen: boolean
  readonly idleStopMinutes: number | null
}

const GENERIC_ERROR = 'Something went wrong. Try again.'
const ERROR_TEXT: Readonly<Record<string, string>> = {
  hermes_offline: 'Hermes is offline',
  not_found: 'That bot no longer exists',
  primary_not_supported: 'Not available for the primary bot',
  screen_config_failed: "Couldn't save the screen settings",
  bad_body: GENERIC_ERROR
}

/** Hermes's own words (`hermes_error`) pass through; every other code becomes readable text, never the raw code. */
function screenErrorText(code: string | null, message: unknown): string {
  if (code === 'hermes_error' && typeof message === 'string' && message) return message
  return (code && ERROR_TEXT[code]) || GENERIC_ERROR
}

async function screenJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await crewFetch(path, method === 'GET' ? {} : {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  })
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: unknown; message?: unknown } | null
    const code = typeof parsed?.error === 'string' ? parsed.error : null
    throw new ScreenApiError(res.status, code, screenErrorText(code, parsed?.message))
  }
  return (await res.json()) as T
}

const screenPath = (name: string, tail: string): string => `/crew/bots/${encodeURIComponent(name)}/screen/${tail}`

/** Start the bot's screen on the server, which sets the 15-minute idle stop first. Resolves with `display.status`. */
export const startScreen = <T = unknown>(name: string): Promise<T> => screenJson<T>(screenPath(name, 'start'), 'POST')

export const getScreenConfig = (name: string): Promise<ScreenConfigView> => screenJson(screenPath(name, 'config'), 'GET')

export const setUseScreen = (name: string, useScreen: boolean): Promise<ScreenConfigView> => screenJson(screenPath(name, 'config'), 'PUT', { useScreen })
