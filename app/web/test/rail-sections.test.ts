import { describe, expect, it } from 'vitest'

import { connectionText, matchesFind, railSections, railSummary, seatableBots } from '@/features/rail/rail-sections'

import { bot } from './fixtures'

const names = (bots: readonly { name: string }[]) => bots.map(b => b.name)

const crew = [
  bot({ name: 'plain', title: 'Plain' }),
  bot({ name: 'pin', title: 'Pin', pinned: true }),
  bot({ name: 'ask', title: 'Ask', status: 'needs_you', pinned: true }),
  bot({ name: 'gone', title: 'Gone', hidden: true, pinned: true }),
  bot({ name: 'hidden-ask', title: 'Hidden ask', hidden: true, status: 'needs_you' }),
  bot({ name: 'default', title: 'Hermes', isPrimary: true, status: 'needs_you', hidden: true }),
  bot({ name: 'busy', title: 'Busy', status: 'working' })
]

describe('railSections', () => {
  it('puts each bot in exactly one section: primary pinned first, then needs you, hidden, pinned, crew', () => {
    const sections = railSections(crew, true)
    expect(names(sections.pinned)).toEqual(['default', 'pin'])
    expect(names(sections.needsYou)).toEqual(['ask', 'hidden-ask'])
    expect(names(sections.hidden)).toEqual(['gone'])
    expect(names(sections.crew)).toEqual(['plain', 'busy'])
    const all = [...sections.needsYou, ...sections.pinned, ...sections.crew, ...sections.hidden]
    expect(names(all).sort()).toEqual(names(crew).sort())
  })

  it('keeps a needing bot in its usual section while statuses are hidden', () => {
    const sections = railSections(crew, false)
    expect(sections.needsYou).toEqual([])
    expect(names(sections.pinned)).toEqual(['default', 'pin', 'ask'])
    expect(names(sections.hidden)).toEqual(['gone', 'hidden-ask'])
    expect(names(sections.crew)).toEqual(['plain', 'busy'])
  })
})

describe('matchesFind', () => {
  const fixer = bot({ name: 'fix-it', title: 'Mender', job: 'Repairs flaky tests', role: 'engineer' })

  it('finds by title, handle, job and role label', () => {
    expect(matchesFind(fixer, 'mend')).toBe(true)
    expect(matchesFind(fixer, 'FIX-')).toBe(true)
    expect(matchesFind(fixer, '  flaky ')).toBe(true)
    expect(matchesFind(fixer, 'engin')).toBe(true)
    expect(matchesFind(fixer, 'research')).toBe(false)
    expect(matchesFind(bot({ name: 'x', title: 'X' }), 'generalist')).toBe(false)
  })

  it('matches every bot for an empty or blank query', () => {
    expect(matchesFind(fixer, '')).toBe(true)
    expect(matchesFind(fixer, '   ')).toBe(true)
  })
})

describe('railSummary', () => {
  const three = [bot({ name: 'a' }), bot({ name: 'b', status: 'working' }), bot({ name: 'c', status: 'needs_you' })]

  it('summarises bots and working bots', () => {
    expect(railSummary(three, true)).toBe('3 bots · 1 working')
    expect(railSummary([bot({ name: 'a' })], true)).toBe('1 bot')
    expect(railSummary(three, false)).toBe('3 bots')
    expect(railSummary([], true)).toBe('0 bots')
  })

  it('leaves hidden bots out of the count', () => {
    expect(railSummary([...three, bot({ name: 'old', hidden: true, status: 'working' })], true)).toBe('3 bots · 1 working')
  })
})

describe('connectionText', () => {
  it('is null when connected and names every other state, the Crew stream first', () => {
    expect(connectionText('connected', true)).toBeNull()
    expect(connectionText('connected', false)).toBe('Reconnecting…')
    expect(connectionText('offline', false)).toBe('Reconnecting…')
    expect(connectionText('connecting', true)).toBe('Connecting…')
    expect(connectionText('offline', true)).toBe('Hermes offline')
    expect(connectionText('signed_out', true)).toBe('Signed out of Hermes')
  })
})

describe('the primary and `hidden` (final review 2)', () => {
  const primary = bot({ name: 'default', title: 'Hermes', isPrimary: true, hidden: true })

  it('counts a primary marked hidden: it never leaves the rail', () => {
    expect(railSummary([primary, bot({ name: 'a' }), bot({ name: 'old', hidden: true })], true)).toBe('2 bots')
  })

  it('offers a primary marked hidden to the New group picker, and no other hidden or unseatable bot', () => {
    const bots = [primary, bot({ name: 'a' }), bot({ name: 'old', hidden: true }), bot({ name: 'far' })]
    expect(names(seatableBots(bots, ['default', 'a', 'old']))).toEqual(['default', 'a'])
  })
})
