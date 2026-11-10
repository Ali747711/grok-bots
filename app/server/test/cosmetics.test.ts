import { describe, expect, it } from 'vitest'

import { BOT_ROLES, botRoleSchema, readPinned, readRole } from '../src/bots/cosmetics.js'

describe('cosmetics', () => {
  it('reads a listed role and null for anything else', () => {
    expect(readRole('engineer')).toBe('engineer')
    for (const role of BOT_ROLES) expect(readRole(role)).toBe(role)
    for (const bad of ['chef', 3, null, undefined, {}, 'Engineer']) expect(readRole(bad)).toBeNull()
    expect(botRoleSchema.safeParse('chef').success).toBe(false)
  })

  it('reads pinned only from boolean true', () => {
    expect(readPinned(true)).toBe(true)
    for (const bad of ['true', 1, null, undefined, false]) expect(readPinned(bad)).toBe(false)
  })
})
