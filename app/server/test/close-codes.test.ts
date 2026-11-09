import { describe, expect, it } from 'vitest'

import { closeReason } from '../src/hermes/close-codes.js'

describe('closeReason', () => {
  it('keeps short and ASCII reasons whole', () => {
    expect(closeReason('control-taken')).toBe('control-taken')
    expect(closeReason('x'.repeat(123))).toHaveLength(123)
  })

  it('cuts by UTF-8 bytes to at most 123 and never splits a character', () => {
    const cjk = '界'.repeat(100) // 3 bytes each
    const out = closeReason(cjk)
    expect(Buffer.byteLength(out)).toBeLessThanOrEqual(123)
    expect(out).toBe('界'.repeat(41))
    const emoji = closeReason('a' + '😀'.repeat(60)) // 4 bytes each
    expect(Buffer.byteLength(emoji)).toBeLessThanOrEqual(123)
    expect(emoji).not.toContain('�')
    expect(Buffer.from(emoji).toString('utf8')).toBe(emoji)
  })
})
