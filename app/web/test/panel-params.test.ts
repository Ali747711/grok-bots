import { describe, expect, it } from 'vitest'

import { botUrl, parseBotPanel, parseProfileTab, railTarget } from '@/app/panel-params'

describe('panel params', () => {
  it('parses panels and profile tabs', () => {
    expect(parseBotPanel('computer')).toBe('computer')
    expect(parseBotPanel('routines')).toBe('routines')
    expect(parseBotPanel('profile')).toBe('profile')
    for (const value of [null, '', 'group', 'nope', 'Computer']) expect(parseBotPanel(value)).toBeNull()
    for (const tab of ['identity', 'avatar', 'soul', 'skills', 'apps', 'advanced'] as const) expect(parseProfileTab(tab)).toBe(tab)
    for (const value of [null, '', 'nope', 'Advanced']) expect(parseProfileTab(value)).toBe('identity')
  })

  it('builds bot URLs with an encoded name and a tab only for a non-identity profile', () => {
    expect(botUrl('dev', null)).toBe('/bots/dev')
    expect(botUrl('dev', 'computer')).toBe('/bots/dev?panel=computer')
    expect(botUrl('dev', 'routines')).toBe('/bots/dev?panel=routines')
    expect(botUrl('dev', 'profile')).toBe('/bots/dev?panel=profile')
    expect(botUrl('dev', 'profile', 'identity')).toBe('/bots/dev?panel=profile')
    expect(botUrl('a b', 'profile', 'advanced')).toBe('/bots/a%20b?panel=profile&tab=advanced')
    // A tab means nothing outside the profile.
    expect(botUrl('dev', 'computer', 'advanced')).toBe('/bots/dev?panel=computer')
    expect(botUrl('dev', null, 'advanced')).toBe('/bots/dev')
  })

  it('keeps the current panel on a bot page, none and profile included, and uses the remembered one elsewhere', () => {
    expect(railTarget('dev', { onBotPage: true, panel: null }, 'routines')).toBe('/bots/dev')
    expect(railTarget('dev', { onBotPage: true, panel: 'profile' }, 'computer')).toBe('/bots/dev?panel=profile')
    expect(railTarget('dev', { onBotPage: true, panel: 'computer' }, null)).toBe('/bots/dev?panel=computer')
    expect(railTarget('dev', { onBotPage: false, panel: null }, 'routines')).toBe('/bots/dev?panel=routines')
    expect(railTarget('dev', { onBotPage: false, panel: null }, 'computer')).toBe('/bots/dev?panel=computer')
    expect(railTarget('dev', { onBotPage: false, panel: null }, null)).toBe('/bots/dev')
  })
})
