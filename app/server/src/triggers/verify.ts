import { createHash, createHmac, timingSafeEqual } from 'node:crypto'

export interface HeaderGetter {
  get(name: string): string | null
}

export type VerifyResult = { ok: true; eventType: string; deliveryId: string | null } | { ok: false; reason: string }

export const MAX_SKEW_S = 300
const SIG_RE = /^sha256=([0-9a-f]{64})$/i
const TIMESTAMP_RE = /^\d{1,11}$/
const DELIVERY_MAX = 200
const EVENT_MAX = 64

const hmac = (secret: string, parts: readonly (string | Buffer)[]): Buffer => {
  const h = createHmac('sha256', secret)
  for (const p of parts) h.update(p)
  return h.digest()
}

/** Constant-time; a malformed or wrong-length signature is simply false. */
function matches(header: string | null, expected: Buffer): boolean | null {
  if (!header) return null
  const m = SIG_RE.exec(header.trim())
  if (!m?.[1]) return false
  const given = Buffer.from(m[1], 'hex')
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/** Make a sender-supplied event name safe to log and fence: control/odd characters become `_`, cut to 64. */
export function eventNameOf(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  return t ? t.replace(/[^A-Za-z0-9._:/-]/g, '_').slice(0, EVENT_MAX) : null
}

/** The sender's delivery id for dedupe; an overlong one is hashed so the stored id stays small. */
export function deliveryIdOf(v: string | null | undefined): string | null {
  const t = (v ?? '').trim()
  if (!t) return null
  return t.length > DELIVERY_MAX ? createHash('sha256').update(t).digest('hex') : t
}

export const signGithub = (raw: Buffer, secret: string): string => `sha256=${hmac(secret, [raw]).toString('hex')}`
export const signGeneric = (raw: Buffer, secret: string, timestamp: string): string => `sha256=${hmac(secret, [`${timestamp}.`, raw]).toString('hex')}`

export function verifyGithub(raw: Buffer, headers: HeaderGetter, secret: string): VerifyResult {
  const ok = matches(headers.get('x-hub-signature-256'), hmac(secret, [raw]))
  if (ok === null) return { ok: false, reason: 'missing signature' }
  if (!ok) return { ok: false, reason: 'signature does not match' }
  return { ok: true, eventType: eventNameOf(headers.get('x-github-event')) ?? 'unknown', deliveryId: deliveryIdOf(headers.get('x-github-delivery')) }
}

export function verifyGeneric(raw: Buffer, headers: HeaderGetter, secret: string, nowMs: number): VerifyResult {
  const signature = headers.get('x-crew-signature')
  if (!signature) return { ok: false, reason: 'missing signature' }
  const ts = headers.get('x-crew-timestamp')?.trim() ?? ''
  if (!TIMESTAMP_RE.test(ts)) return { ok: false, reason: 'missing or malformed timestamp' }
  if (Math.abs(nowMs - Number(ts) * 1000) > MAX_SKEW_S * 1000) return { ok: false, reason: 'timestamp too old or too new' }
  if (!matches(signature, hmac(secret, [`${ts}.`, raw]))) return { ok: false, reason: 'signature does not match' }
  return { ok: true, eventType: eventNameOf(headers.get('x-crew-event')) ?? 'event', deliveryId: deliveryIdOf(headers.get('x-crew-delivery')) }
}
