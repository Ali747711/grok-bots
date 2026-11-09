import { eventNameOf } from './verify.js'

export type ParsedPayload = { kind: 'json'; value: unknown } | { kind: 'text'; text: string }

function tryJson(text: string): { value: unknown } | null {
  try {
    return { value: JSON.parse(text) }
  } catch {
    return null
  }
}

/** Form-encoded `payload=<json>` (GitHub's default), else JSON whatever the content type says, else text. */
export function parsePayload(raw: Buffer, contentType: string | null): ParsedPayload {
  const text = raw.toString('utf8')
  if (contentType?.toLowerCase().includes('application/x-www-form-urlencoded')) {
    const param = new URLSearchParams(text).get('payload')
    if (param !== null) {
      const json = tryJson(param)
      return json ? { kind: 'json', value: json.value } : { kind: 'text', text: param }
    }
  }
  const json = text.trim() ? tryJson(text) : null
  return json ? { kind: 'json', value: json.value } : { kind: 'text', text }
}

/** The payload's `action` (GitHub's "opened", "closed", …), made name-safe; null when absent. */
export function payloadAction(p: ParsedPayload): string | null {
  if (p.kind !== 'json' || !p.value || typeof p.value !== 'object') return null
  const action = (p.value as { action?: unknown }).action
  return typeof action === 'string' ? eventNameOf(action) : null
}
