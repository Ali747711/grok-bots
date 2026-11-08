import { describe, expect, it } from 'vitest'

import { AVATAR_TYPES, avatarSeed, avatarState, deriveAvatarType, resolvedAvatar } from '@/features/avatars/avatar-model'

import { bot } from './fixtures'

const NOW = 1_800_000_000_000
const HOUR = 3_600_000

describe('deriveAvatarType (same cases as the server test)', () => {
  it('derives the same type for the same handle', () => {
    expect(deriveAvatarType('scout')).toBe(deriveAvatarType('scout'))
    expect(AVATAR_TYPES).toContain(deriveAvatarType('한글-u'))
  })

  it('is FNV-1a 32-bit over UTF-16 code units, modulo 18 (pinned values)', () => {
    expect(['', 'a', 'scout', 'default', 'inbox-triage', '한글-u'].map(deriveAvatarType))
      .toEqual(['drop', 'pebble', 'ghost', 'hexagon', 'cloud', 'droid'])
  })

  it('has 18 types', () => expect(AVATAR_TYPES).toHaveLength(18))
})

describe('avatarSeed', () => {
  it('is the 32-bit hash over 2^32, stable and in [0, 1)', () => {
    expect(avatarSeed('a')).toBeCloseTo(3826002220 / 2 ** 32, 12)
    expect(avatarSeed('scout')).toBe(avatarSeed('scout'))
    for (const h of ['', 'a', 'scout', '한글-u']) expect(avatarSeed(h)).toBeGreaterThanOrEqual(0), expect(avatarSeed(h)).toBeLessThan(1)
  })
})

describe('avatarState', () => {
  it('maps status to avatar state', () => {
    expect(avatarState({ status: 'working', hidden: false, lastActive: null }, NOW)).toBe('working')
    expect(avatarState({ status: 'idle', hidden: false, lastActive: null }, NOW)).toBe('default')
    expect(avatarState({ status: 'needs_you', hidden: false, lastActive: null }, NOW)).toBe('default')
  })

  it('sleeps hidden bots and bots idle for over a day but never brand-new ones', () => {
    expect(avatarState({ status: 'idle', hidden: true, lastActive: null }, NOW)).toBe('sleeping')
    expect(avatarState({ status: 'idle', hidden: false, lastActive: (NOW - 25 * HOUR) / 1000 }, NOW)).toBe('sleeping')
    expect(avatarState({ status: 'idle', hidden: false, lastActive: (NOW - 23 * HOUR) / 1000 }, NOW)).toBe('default')
    expect(avatarState({ status: 'idle', hidden: false, lastActive: null }, NOW)).toBe('default')
  })

  it('a working or needs-you bot is awake even when old, a hidden one sleeps even when working', () => {
    expect(avatarState({ status: 'working', hidden: false, lastActive: (NOW - 48 * HOUR) / 1000 }, NOW)).toBe('working')
    expect(avatarState({ status: 'needs_you', hidden: false, lastActive: (NOW - 48 * HOUR) / 1000 }, NOW)).toBe('default')
    expect(avatarState({ status: 'working', hidden: true, lastActive: null }, NOW)).toBe('sleeping')
  })
})

describe('resolvedAvatar', () => {
  it('ignores a back-filled face and derives the avatar', () => {
    expect(resolvedAvatar(bot({ name: 'scout', hasAvatar: true, imageKind: null, avatar: null }))).toEqual({ kind: 'avatar', type: deriveAvatarType('scout') })
  })

  it('uses the chosen type and colour', () => {
    expect(resolvedAvatar(bot({ name: 'scout', avatar: { type: 'cat', color: '#112233' } }))).toEqual({ kind: 'avatar', type: 'cat', color: '#112233' })
    expect(resolvedAvatar(bot({ name: 'scout', avatar: { type: 'cat' } }))).toEqual({ kind: 'avatar', type: 'cat' })
  })

  it('shows a photo only for an uploaded photo', () => {
    expect(resolvedAvatar(bot({ name: 'scout', imageKind: 'photo', hasAvatar: true }))).toEqual({ kind: 'photo' })
    expect(resolvedAvatar(bot({ name: 'scout', imageKind: 'photo', hasAvatar: false })).kind).toBe('avatar')
    expect(resolvedAvatar(bot({ name: 'scout', imageKind: 'shape', hasAvatar: true })).kind).toBe('avatar')
  })
})
