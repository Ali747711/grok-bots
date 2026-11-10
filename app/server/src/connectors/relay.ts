/** Pure rules for the per-bot MCP relay (§11.8): what a bot may send, what comes back, and the fixed texts. */
export const RELAY_MAX_BYTES = 1_048_576
export const RELAY_TIMEOUT_MS = 240_000
export const UPSTREAM_MAX_BYTES = 10_485_760

export const RELAY_TEXT = {
  noKey: 'Crew has no Composio key, so app tools are off.',
  rejected: "Composio did not accept Crew's key.",
  unreachable: "Couldn't reach Composio.",
  notAllowed: 'This bot is not allowed to use that app tool.',
  noMethod: 'Method not available.'
} as const

export type Verdict =
  | { readonly kind: 'forward' | 'filter' }
  | { readonly kind: 'refuse'; readonly code: -32600 | -32601 | -32602; readonly message: string }

const refuse = (code: -32600 | -32601 | -32602, message: string): Verdict => ({ kind: 'refuse', code, message })
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const MEMBERS = new Set(['jsonrpc', 'id', 'method', 'params', 'result', 'error'])
/** A key that is a JSON-RPC member only up to letter case: another parser could read it as the member. */
const isMemberVariant = (key: string): boolean => key !== key.toLowerCase() && MEMBERS.has(key.toLowerCase())

/**
 * The message rebuilt from only the members `judge` looked at, so what is forwarded is what was checked
 * (duplicate keys are already collapsed by the parse; unknown keys are dropped). Call after `judge` accepts.
 */
export function canonicalMessage(message: Record<string, unknown>): Record<string, unknown> {
  const pick = (keys: readonly string[]): Record<string, unknown> =>
    Object.fromEntries(keys.filter(key => key in message).map(key => [key, message[key]]))
  return message.method !== undefined
    ? pick(['jsonrpc', 'id', 'method', 'params'])
    : pick(['jsonrpc', 'id', 'result', 'error'])
}

/** R3: one JSON object per body; methods are compared exactly, and a tool call needs an allowed name. */
export function judge(message: unknown, allowed: ReadonlySet<string>): Verdict {
  if (!isObject(message) || Object.keys(message).some(isMemberVariant)) return refuse(-32600, 'Invalid request')
  const { method } = message
  if (method === undefined) {
    const isResponse = 'id' in message && ('result' in message || 'error' in message)
    return isResponse ? { kind: 'forward' } : refuse(-32600, 'Invalid request')
  }
  if (typeof method !== 'string') return refuse(-32600, 'Invalid request')
  if (method === 'initialize' || method === 'ping' || method.startsWith('notifications/')) return { kind: 'forward' }
  if (method === 'tools/list') return { kind: 'filter' }
  if (method !== 'tools/call') return refuse(-32601, RELAY_TEXT.noMethod)
  const params = message.params
  if (isObject(params) && Object.keys(params).some(key => key !== 'name' && key.toLowerCase() === 'name')) {
    return refuse(-32600, 'Invalid request')
  }
  const name = isObject(params) ? params.name : undefined
  if (typeof name !== 'string') return refuse(-32602, 'Invalid params')
  return allowed.has(name) ? { kind: 'forward' } : refuse(-32602, RELAY_TEXT.notAllowed)
}

export function parseBearer(header: string | undefined): string | null {
  const match = header === undefined ? null : /^Bearer ([A-Za-z0-9_-]{20,128})$/.exec(header)
  return match?.[1] ?? null
}

function tryParse(text: string): unknown[] {
  try {
    return [JSON.parse(text)]
  } catch {
    return []
  }
}

/** JSON → `[body]`; an event stream → each event's joined `data:` lines. Unparseable parts are skipped. */
export function parseUpstream(contentType: string, text: string): readonly unknown[] {
  if (!contentType.toLowerCase().includes('text/event-stream')) return tryParse(text)
  return text
    .split(/\r?\n\r?\n/)
    .map(event =>
      event
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).replace(/^ /, ''))
        .join('\n')
    )
    .filter(data => data !== '')
    .flatMap(tryParse)
}

/** Drops `result.tools[]` entries outside the allow list; everything else is kept as is. */
export function filterToolsList(message: unknown, allowed: ReadonlySet<string>): unknown {
  if (!isObject(message) || !isObject(message.result) || !Array.isArray(message.result.tools)) return message
  const tools = message.result.tools.filter(tool => isObject(tool) && typeof tool.name === 'string' && allowed.has(tool.name))
  return { ...message, result: { ...message.result, tools } }
}

export function rpcError(id: unknown, code: number, message: string): Record<string, unknown> {
  const safeId = typeof id === 'string' || typeof id === 'number' ? id : null
  return { jsonrpc: '2.0', id: safeId, error: { code, message } }
}
