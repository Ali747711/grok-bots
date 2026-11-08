import type { RawData } from 'ws'

export type FrameVerdict = { forward: true } | { forward: false; reply?: string }

const PARSE_ERROR = -32700
const INVALID_REQUEST = -32600
const METHOD_NOT_FOUND = -32601
const INVALID_PARAMS = -32602

/**
 * The only `display.*` calls a browser may make. `display.start` is absent on purpose: Crew's own
 * route starts screens so the 15-minute idle stop can't be skipped (§11 R7). Anything else under
 * `display.` (install, switchSandboxImage, a future method) is refused: the guard fails closed.
 */
const BROWSER_METHODS: ReadonlySet<string> = new Set([
  'display.status',
  'display.observe',
  'display.lease.acquire',
  'display.lease.release',
  'display.thumbnail',
  'display.stop'
])

const asText = (raw: RawData): string => {
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  return (Buffer.isBuffer(raw) ? raw : Buffer.from(raw)).toString('utf8')
}

// A refused display.* notification (no id) gets an id-null error reply, which the client ignores.
const refusal = (code: number, message: string, id: unknown): FrameVerdict => ({
  forward: false,
  reply: JSON.stringify({ jsonrpc: '2.0', id: typeof id === 'string' || typeof id === 'number' ? id : null, error: { code, message } })
})

/**
 * Inspect one browser→Hermes frame. Hermes runs Python `json.loads(raw.strip())`, which accepts
 * NaN and strips Unicode whitespace, and a display call without `profile` targets the `default` bot
 * (facts 1.1). So every text frame is parsed strictly here first: whatever JS `JSON.parse` rejects is
 * refused instead of forwarded. Frames that pass are forwarded by the caller as the original bytes.
 */
export function checkBrowserFrame(raw: RawData, isBinary: boolean, knownBots: () => ReadonlySet<string>): FrameVerdict {
  if (isBinary) return { forward: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(asText(raw))
  } catch {
    return refusal(PARSE_ERROR, 'parse error', null)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return refusal(INVALID_REQUEST, 'invalid request', null)
  const { id, method, params } = parsed as { id?: unknown; method?: unknown; params?: unknown }
  if (typeof method !== 'string' || !method.startsWith('display.')) return { forward: true }
  if (!BROWSER_METHODS.has(method)) return refusal(METHOD_NOT_FOUND, `${method} is not available from the browser`, id)
  const profile = params && typeof params === 'object' && !Array.isArray(params) ? (params as { profile?: unknown }).profile : undefined
  if (typeof profile !== 'string' || !knownBots().has(profile)) return refusal(INVALID_PARAMS, 'display calls need the profile of a known bot', id)
  return { forward: true }
}
