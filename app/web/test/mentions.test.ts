import { describe, expect, it } from 'vitest'

import { findMentions, mentionQueryAt, recipients, whoWillAnswer } from '@/features/groups/mentions'
import type { GroupMemberView } from '@/state/types'

const m: GroupMemberView[] = ['crew-test', 'e2e1', 'hermes'].map(h => ({ memberId: h, profile: h, handle: h, displayName: null }))
const titleOf = (id: string): string => (id === 'e2e1' ? 'E2E One' : id)
const base = { members: m, leadMemberId: null, firstInTopic: true, titleOf }

describe('recipients', () => {
  it('resolves handles with casefold and stops tokens at punctuation', () => {
    expect(recipients('@crew-test hi', m)).toEqual(['crew-test'])
    expect(recipients('@CREW-TEST, @e2e1!', m)).toEqual(['crew-test', 'e2e1'])
  })
  it('treats a trailing dot as part of the token', () => {
    expect(recipients('@crew-test. hi', m)).toBeNull()
  })
  it('ignores unknown handles and expands everyone/all', () => {
    expect(recipients('@ghost hi', m)).toBeNull()
    expect(recipients('@everyone', m)).toEqual(['crew-test', 'e2e1', 'hermes'])
    expect(recipients('@all hi', m)).toEqual(['crew-test', 'e2e1', 'hermes'])
  })
  it('reports ranges for resolving tokens only', () => {
    expect(findMentions('hi @e2e1 and @ghost', m)).toEqual([{ start: 3, end: 8, memberIds: ['e2e1'] }])
  })
})

describe('whoWillAnswer', () => {
  it('names one, two or three mentioned bots', () => {
    expect(whoWillAnswer({ ...base, text: '@e2e1 hi', routing: 'auto' })).toBe('@e2e1 will reply')
    expect(whoWillAnswer({ ...base, text: '@e2e1 @hermes', routing: 'auto' })).toBe('@e2e1 and @hermes will reply')
    expect(whoWillAnswer({ ...base, text: '@crew-test @e2e1 @hermes', routing: 'auto' })).toBe('@crew-test, @e2e1 and @hermes will reply')
  })
  it('says everyone for @everyone', () => {
    expect(whoWillAnswer({ ...base, text: '@everyone', routing: 'auto' })).toBe('Everyone (3 bots) will reply')
  })
  it('follows the reply rule on a topic first message', () => {
    expect(whoWillAnswer({ ...base, text: 'hi', routing: 'auto' })).toBe('Auto will pick who replies')
    expect(whoWillAnswer({ ...base, text: 'hi', routing: 'everyone' })).toBe('Everyone (3 bots) will reply')
    expect(whoWillAnswer({ ...base, text: 'hi', routing: 'lead', leadMemberId: 'e2e1' })).toBe('E2E One will pick who replies')
  })
  it('wakes everyone on an unaddressed follow-up', () => {
    expect(whoWillAnswer({ ...base, text: 'hi', routing: 'auto', firstInTopic: false })).toBe('Everyone (3 bots) will reply · @mention to ask one bot')
  })
})

describe('mentionQueryAt', () => {
  it('finds the token being typed', () => {
    expect(mentionQueryAt('hello @cr', 9)).toEqual({ start: 6, query: 'cr' })
    expect(mentionQueryAt('@', 1)).toEqual({ start: 0, query: '' })
  })
  it('needs @ at the start or after whitespace', () => {
    expect(mentionQueryAt('mail a@b', 8)).toBeNull()
    expect(mentionQueryAt('hello @cr there', 15)).toBeNull()
  })
})
