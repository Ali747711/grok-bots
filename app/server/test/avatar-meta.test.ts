import { describe, expect, it } from 'vitest'

import { AVATAR_DEFAULT_COLORS, AVATAR_TYPES, type AvatarType, avatarMetaPatch, deriveAvatarType, hermesShapeFor, readCrewAvatar } from '../src/bots/avatar.js'

describe('deriveAvatarType', () => {
  it('derives the same type for the same handle', () => {
    expect(deriveAvatarType('scout')).toBe(deriveAvatarType('scout'))
    expect(AVATAR_TYPES).toContain(deriveAvatarType('한글-u'))
  })

  it('is FNV-1a 32-bit over UTF-16 code units, modulo 18 (pinned values for the web copy)', () => {
    expect(['', 'a', 'scout', 'default', 'inbox-triage', '한글-u'].map(deriveAvatarType))
      .toEqual(['drop', 'pebble', 'ghost', 'hexagon', 'cloud', 'droid'])
  })

  it('spreads handles over many types', () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => deriveAvatarType(`bot-${i}`)))
    expect(seen.size).toBeGreaterThan(12)
  })
})

describe('hermes shape and meta patch', () => {
  it.each([['circle', 'circle'], ['square', 'squircle'], ['triangle', 'triangle'], ['hexagon', 'hexagon'], ['cloud', 'cloud'],
    ['drop', 'drop'], ['pill', 'pill'], ['blob', 'blob'], ['cat', 'blob'], ['clover', 'blob']])('maps %s to the hermes shape %s', (t, s) => {
    expect(hermesShapeFor(t as AvatarType)).toBe(s)
  })

  it('has a default colour for each of the 18 types', () => {
    expect(AVATAR_TYPES).toHaveLength(18)
    for (const type of AVATAR_TYPES) expect(AVATAR_DEFAULT_COLORS[type]).toMatch(/^#[0-9A-F]{6}$/)
  })

  it('writes crewAvatar plus the implied hermes shape and colour', () => {
    expect(avatarMetaPatch({ type: 'cat' })).toEqual({ crewAvatar: { type: 'cat' }, shape: 'blob', color: AVATAR_DEFAULT_COLORS.cat, custom: true })
    expect(avatarMetaPatch({ type: 'square', color: '#123456' })).toEqual({ crewAvatar: { type: 'square', color: '#123456' }, shape: 'squircle', color: '#123456', custom: true })
  })
})

describe('readCrewAvatar', () => {
  it('accepts a valid avatar and rejects everything else without throwing', () => {
    expect(readCrewAvatar({ type: 'star', color: '#aBcDeF' })).toEqual({ type: 'star', color: '#aBcDeF' })
    expect(readCrewAvatar({ type: 'star' })).toEqual({ type: 'star' })
    for (const bad of [null, undefined, 'cat', 3, [], {}, { type: 'dragon' }, { type: 'cat', color: 'red' }, { type: 'cat', color: 5 }, { type: 7 }]) {
      expect(readCrewAvatar(bad)).toBeNull()
    }
  })
})
