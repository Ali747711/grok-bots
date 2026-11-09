import { describe, expect, it } from 'vitest'

import { slugifyProfileName, validateBotName } from '../src/bots/names.js'

describe('slugifyProfileName', () => {
  it('slugifies like the official client', () => {
    expect(slugifyProfileName('Research Bot')).toBe('research-bot')
    expect(slugifyProfileName('Résumé Helper')).toBe('resume-helper')
    expect(slugifyProfileName('한글')).toBe('ud55c-uae00')
    expect(slugifyProfileName('x'.repeat(80))).toHaveLength(64)
  })

  // Ported from hermes-bots/labels.profile-name.test.ts (2bd378ed).
  it('derives a stable ASCII id from a CJK name', () => {
    expect(slugifyProfileName('小助手')).toBe('u5c0f-u52a9-u624b')
    expect(slugifyProfileName('test机器人')).toBe('test-u673a-u5668-u4eba')
    expect(slugifyProfileName('u5c0f-u52a9-u624b')).toBe('u5c0f-u52a9-u624b')
    expect(slugifyProfileName('Inbox Triage')).toBe('inbox-triage')
    expect(slugifyProfileName('🤖')).toBe('')
  })

  it('folds accented Latin to its base letters', () => {
    expect(slugifyProfileName('Café Résumé')).toBe('cafe-resume')
  })

  it('keeps one token per NFC code point and never splits a token at the cap', () => {
    expect(slugifyProfileName('ガ')).not.toBe(slugifyProfileName('カ'))
    const long = slugifyProfileName('小助手'.repeat(7))
    expect(long).toBe('u5c0f-u52a9-u624b-u5c0f-u52a9-u624b-u5c0f-u52a9-u624b-u5c0f')
    expect(long).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/)
  })
})

describe('validateBotName', () => {
  it('accepts a good name and rejects reserved and malformed ones', () => {
    expect(validateBotName('scout')).toEqual({ ok: true })
    for (const reserved of ['hermes', 'default', 'test', 'tmp', 'root', 'sudo']) {
      expect(validateBotName(reserved)).toEqual({ ok: false, reason: 'reserved' })
    }
    for (const loose of ['Scout', ' scout ', 'MyBot', 'Default']) {
      expect(validateBotName(loose)).toEqual({ ok: false, reason: 'format' })
    }
    expect(validateBotName('-a')).toEqual({ ok: false, reason: 'format' })
    expect(validateBotName('a'.repeat(65))).toEqual({ ok: false, reason: 'format' })
    expect(validateBotName('')).toEqual({ ok: false, reason: 'empty' })
    expect(validateBotName('  ')).toEqual({ ok: false, reason: 'format' })
  })
})
