const SERVICE_RESTART = 1012

/** Close codes a server may send; everything else (1005/1006 = no status / abnormal) becomes 1012. */
export function forwardableCode(code: number): number {
  const valid = (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011) || (code >= 3000 && code <= 4999)
  return valid ? code : SERVICE_RESTART
}

/** A WebSocket close frame carries at most 125 bytes: 2 for the code, so 123 for the reason. */
const MAX_REASON_BYTES = 123

/**
 * `reason` cut to at most 123 UTF-8 bytes without splitting a character, so `ws` can never throw a
 * RangeError when it is forwarded (a character count is not a byte count: CJK is 3 bytes, emoji 4).
 */
export function closeReason(reason: string): string {
  if (Buffer.byteLength(reason) <= MAX_REASON_BYTES) return reason
  let out = ''
  let bytes = 0
  for (const char of reason) {
    const size = Buffer.byteLength(char)
    if (bytes + size > MAX_REASON_BYTES) break
    out += char
    bytes += size
  }
  return out
}
