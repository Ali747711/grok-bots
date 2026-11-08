import { createHmac, timingSafeEqual } from 'node:crypto'

import { z } from 'zod'

export interface CrewSession {
  readonly sid: string
  readonly exp: number
}

const sessionSchema = z.object({ sid: z.string().min(1), exp: z.number().int() })

function mac(key: Buffer, payload: string): Buffer {
  return createHmac('sha256', key).update(payload).digest()
}

/** Encode a session as `base64url(json).base64url(hmac)`. Stateless, so it survives server restarts. */
export function signSession(key: Buffer, session: CrewSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString('base64url')
  return `${payload}.${mac(key, payload).toString('base64url')}`
}

/** Return the session if the signature is valid and it has not expired; otherwise null. */
export function verifySession(key: Buffer, value: string | undefined, nowMs: number): CrewSession | null {
  if (!value) return null
  const [payload, signature, ...rest] = value.split('.')
  if (!payload || !signature || rest.length > 0) return null

  const expected = mac(key, payload)
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  try {
    const parsed = sessionSchema.safeParse(JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')))
    if (!parsed.success || parsed.data.exp < nowMs) return null
    return parsed.data
  } catch {
    // Malformed JSON behind a valid MAC cannot happen with our own signer; treat as invalid.
    return null
  }
}
