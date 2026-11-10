import { describe, expect, it } from 'vitest'

import { parsePayload, payloadAction } from '../src/triggers/payload.js'

describe('parsePayload', () => {
  it('parses JSON whatever the content type', () => {
    expect(parsePayload(Buffer.from('{"a":1}'), 'application/json')).toEqual({ kind: 'json', value: { a: 1 } })
    expect(parsePayload(Buffer.from('{"a":1}'), 'text/plain')).toEqual({ kind: 'json', value: { a: 1 } })
  })
  it('unwraps form-encoded payload, falling back to text', () => {
    expect(parsePayload(Buffer.from('payload=%7B%22action%22%3A%22opened%22%7D'), 'application/x-www-form-urlencoded')).toEqual({ kind: 'json', value: { action: 'opened' } })
    expect(parsePayload(Buffer.from('payload=not+json'), 'application/x-www-form-urlencoded')).toEqual({ kind: 'text', text: 'not json' })
    expect(parsePayload(Buffer.from('other=1'), 'application/x-www-form-urlencoded')).toEqual({ kind: 'text', text: 'other=1' })
  })
  it('falls back to text', () => {
    expect(parsePayload(Buffer.from('{oops'), 'application/json')).toEqual({ kind: 'text', text: '{oops' })
    expect(parsePayload(Buffer.alloc(0), null)).toEqual({ kind: 'text', text: '' })
  })
})

describe('payloadAction', () => {
  it('reads a string action only', () => {
    expect(payloadAction({ kind: 'json', value: { action: 'opened' } })).toBe('opened')
    expect(payloadAction({ kind: 'json', value: { action: 5 } })).toBeNull()
    expect(payloadAction({ kind: 'json', value: null })).toBeNull()
    expect(payloadAction({ kind: 'json', value: [1] })).toBeNull()
    expect(payloadAction({ kind: 'text', text: 'x' })).toBeNull()
  })
})
