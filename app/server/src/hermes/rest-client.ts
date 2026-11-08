import { HermesRestError } from './errors.js'
import type { HermesToken } from './token.js'

const DEFAULT_TIMEOUT_MS = 30_000

export type RestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface RestOptions {
  readonly query?: Record<string, string>
  readonly body?: unknown
  /** 0 = no Crew-side timeout (Node's fetch still ends a request that gets no headers for ~300 s). */
  readonly timeoutMs?: number
}

export interface HermesRest {
  request<T>(method: RestMethod, path: string, opts?: RestOptions): Promise<T>
}

export interface HermesRestDeps {
  readonly hermesUrl: string
  readonly token: HermesToken
  readonly fetch?: typeof fetch
}

async function errorDetail(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  try {
    const json = JSON.parse(text) as Record<string, unknown>
    for (const key of ['detail', 'error', 'message']) {
      const value = json[key]
      if (typeof value === 'string' && value) return value
      if (value !== undefined && value !== null && typeof value === 'object') return JSON.stringify(value)
    }
  } catch {
    // Not JSON: fall through to the raw text.
  }
  return text.slice(0, 500) || res.statusText || `HTTP ${res.status}`
}

/** Server-side REST client for Hermes. A 401 re-reads the token once and retries once, like the proxy. */
export function createHermesRest(deps: HermesRestDeps): HermesRest {
  const doFetch = deps.fetch ?? fetch
  const send = (method: RestMethod, path: string, opts: RestOptions, token: string): Promise<Response> => {
    const url = new URL(path, deps.hermesUrl)
    for (const [key, value] of Object.entries(opts.query ?? {})) url.searchParams.set(key, value)
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const headers: Record<string, string> = { 'x-hermes-session-token': token }
    if (opts.body !== undefined) headers['content-type'] = 'application/json'
    return doFetch(url, {
      method,
      headers,
      redirect: 'manual',
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      ...(timeoutMs > 0 ? { signal: AbortSignal.timeout(timeoutMs) } : {})
    })
  }

  return {
    async request<T>(method: RestMethod, path: string, opts: RestOptions = {}): Promise<T> {
      let res = await send(method, path, opts, await deps.token.get())
      if (res.status === 401) {
        await res.body?.cancel()
        res = await send(method, path, opts, await deps.token.refresh())
        if (res.status === 401) deps.token.markSignedOut()
      }
      if (!res.ok) throw new HermesRestError(res.status, await errorDetail(res))
      deps.token.markOk()
      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    }
  }
}
