import { createHmac } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { deliveryIdOf, eventNameOf, signGeneric, signGithub, verifyGeneric, verifyGithub } from '../src/triggers/verify.js'

const raw = Buffer.from('{"action":"opened"}')
const secret = 's3cret'
const gh = (sig?: string) => new Headers({ 'x-github-event': 'issues', 'x-github-delivery': 'd-1', ...(sig ? { 'x-hub-signature-256': sig } : {}) })
const gen = (ts?: string, sig?: string, extra: Record<string, string> = {}) =>
  new Headers({ ...(ts ? { 'x-crew-timestamp': ts } : {}), ...(sig ? { 'x-crew-signature': sig } : {}), ...extra })
const ts = '1762680000'
const now = 1762680000_000

describe('verifyGithub', () => {
  it('signs and verifies', () => {
    expect(signGithub(raw, secret)).toBe('sha256=' + createHmac('sha256', secret).update(raw).digest('hex'))
    expect(verifyGithub(raw, gh(signGithub(raw, secret)), secret)).toMatchObject({ ok: true, eventType: 'issues', deliveryId: 'd-1' })
  })
  it('refuses missing, wrong and malformed signatures without throwing', () => {
    expect(verifyGithub(raw, gh(), secret)).toEqual({ ok: false, reason: 'missing signature' })
    expect(verifyGithub(raw, gh('sha256=' + '0'.repeat(64)), secret)).toEqual({ ok: false, reason: 'signature does not match' })
    expect(verifyGithub(raw, gh('sha256=zz'), secret).ok).toBe(false)
    expect(verifyGithub(raw, gh('sha256=' + 'ab'.repeat(40)), secret).ok).toBe(false)
    expect(verifyGithub(raw, gh(signGithub(raw, 'other')), secret).ok).toBe(false)
  })
  it('accepts upper-case hex and defaults the event type', () => {
    const sig = signGithub(raw, secret)
    expect(verifyGithub(raw, gh('sha256=' + sig.slice(7).toUpperCase()), secret).ok).toBe(true)
    expect(verifyGithub(raw, new Headers({ 'x-hub-signature-256': sig }), secret)).toMatchObject({ ok: true, eventType: 'unknown', deliveryId: null })
  })
})

describe('verifyGeneric', () => {
  const sig = signGeneric(raw, secret, ts)
  it('accepts a fresh signed request and defaults the event', () => {
    expect(verifyGeneric(raw, gen(ts, sig), secret, now + 299_000)).toMatchObject({ ok: true, eventType: 'event', deliveryId: null })
    expect(verifyGeneric(raw, gen(ts, sig, { 'x-crew-event': 'build.done', 'x-crew-delivery': 'z9' }), secret, now - 299_000)).toMatchObject({ ok: true, eventType: 'build.done', deliveryId: 'z9' })
  })
  it('enforces the 300 s window both ways', () => {
    expect(verifyGeneric(raw, gen(ts, sig), secret, now + 301_000)).toEqual({ ok: false, reason: 'timestamp too old or too new' })
    expect(verifyGeneric(raw, gen(ts, sig), secret, now - 301_000)).toEqual({ ok: false, reason: 'timestamp too old or too new' })
  })
  it('refuses missing or malformed timestamps and signatures', () => {
    expect(verifyGeneric(raw, gen('1762680000000', sig), secret, now)).toMatchObject({ reason: 'missing or malformed timestamp' })
    expect(verifyGeneric(raw, gen(undefined, sig), secret, now)).toMatchObject({ reason: 'missing or malformed timestamp' })
    expect(verifyGeneric(raw, gen(ts), secret, now)).toEqual({ ok: false, reason: 'missing signature' })
  })
  it('signs the timestamp too: a body-only HMAC does not verify', () => {
    const bodyOnly = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex')
    expect(verifyGeneric(raw, gen(ts, bodyOnly), secret, now)).toMatchObject({ reason: 'signature does not match' })
    expect(verifyGeneric(raw, gen('1762680001', sig), secret, now)).toMatchObject({ reason: 'signature does not match' })
  })
})

describe('signature value', () => {
  it('is returned lower-case for dedupe', () => {
    const sig = signGithub(raw, secret)
    const upper = 'sha256=' + sig.slice(7).toUpperCase()
    expect(verifyGithub(raw, gh(upper), secret)).toMatchObject({ ok: true, signature: sig.slice(7) })
    const g = signGeneric(raw, secret, '1762680000')
    expect(verifyGeneric(raw, gen('1762680000', g), secret, 1762680000_000)).toMatchObject({ ok: true, signature: g.slice(7) })
  })
})

describe('names and ids', () => {
  it('cleans event names', () => {
    expect(eventNameOf(' iss\nues ')).toBe('iss_ues')
    expect(eventNameOf('x'.repeat(80))).toHaveLength(64)
    expect(eventNameOf('')).toBeNull()
    expect(eventNameOf('  ')).toBeNull()
    expect(eventNameOf(null)).toBeNull()
  })
  it('hashes overlong delivery ids and drops empty ones', () => {
    expect(deliveryIdOf('a'.repeat(201))).toMatch(/^[0-9a-f]{64}$/)
    expect(deliveryIdOf('a'.repeat(200))).toBe('a'.repeat(200))
    expect(deliveryIdOf('  ')).toBeNull()
    expect(deliveryIdOf(' d1 ')).toBe('d1')
  })
})
