import { describe, expect, it } from 'vitest'

import { buildMemberRows, defaultGroupName, handleFor, validateMembers } from '../src/groups/members.js'

const roster = new Set(['default', 'a', 'b', 'c', 'd', 'e', 'f', 'g'])
const seatable = new Set(['default', 'a', 'b', 'c', 'd', 'e', 'f'])

describe('group members', () => {
  it('maps default to hermes', () => {
    expect(handleFor('default')).toBe('hermes')
    expect(handleFor('reese')).toBe('reese')
  })

  it('builds rows with display_name only when non-empty', () => {
    expect(buildMemberRows(['default', 'a', 'b'], new Map([['default', 'Hermes'], ['a', '']]))).toEqual([
      { member_id: 'default', profile: 'default', handle: 'hermes', display_name: 'Hermes', target: { kind: 'local', profile: 'default' } },
      { member_id: 'a', profile: 'a', handle: 'a', target: { kind: 'local', profile: 'a' } },
      { member_id: 'b', profile: 'b', handle: 'b', target: { kind: 'local', profile: 'b' } }
    ])
  })

  it('validates members', () => {
    expect(validateMembers(['a'], roster, seatable)).toEqual({ ok: false, reason: 'count' })
    expect(validateMembers(['a', 'b', 'c', 'd', 'e', 'f', 'default'], roster, seatable)).toEqual({ ok: false, reason: 'count' })
    expect(validateMembers(['a', 'A'], roster, seatable)).toEqual({ ok: false, reason: 'duplicate', profile: 'A' })
    expect(validateMembers(['a', 'zz'], roster, seatable)).toEqual({ ok: false, reason: 'not_in_roster', profile: 'zz' })
    expect(validateMembers(['a', 'g'], roster, seatable)).toEqual({ ok: false, reason: 'not_seatable', profile: 'g' })
    expect(validateMembers(['a', 'b'], roster, seatable)).toEqual({ ok: true })
  })

  it('names a group from titles and cuts at 64 chars', () => {
    expect(defaultGroupName(['Reese', 'X'])).toBe('Reese, X')
    expect(defaultGroupName(['x'.repeat(40), 'y'.repeat(40)])).toHaveLength(64)
  })
})
