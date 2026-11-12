import { describe, expect, it } from 'vitest'

import { BotStateTracker } from '../src/watcher/bot-state.js'
import type { PendingRequest } from '../src/watcher/pending-store.js'

function tracker() {
  const t = new BotStateTracker()
  t.applyProfiles([
    { name: 'default', has_avatar: true, ui_meta: null, model: 'x', canonical_session: { id: 'a', resolved_id: 'b', preview: 'hi', last_active: 5 } },
    { name: 'crew-test', has_avatar: false, ui_meta: { 'hermes-bots': { title: 'Fixture', color: '#57534e' } }, canonical_session: null }
  ])
  t.markSubscribed('crew-test', 'run-1')
  return t
}
const status = (t: BotStateTracker, pending: readonly PendingRequest[] = []) =>
  t.view(pending).find(b => b.name === 'crew-test')?.status

const open: PendingRequest = { id: 'p', kind: 'approval', profile: 'crew-test', sessionId: 'run-1', summary: 's', receivedAt: 1, source: 'event' }

describe('BotStateTracker', () => {
  it('maps ui_meta hermes-bots into BotView and marks default as primary', () => {
    expect(tracker().view([])).toEqual([
      expect.objectContaining({ name: 'default', isPrimary: true, title: 'Hermes', sessionId: 'b', preview: 'hi', lastActive: 5, hasAvatar: true, model: 'x' }),
      expect.objectContaining({ name: 'crew-test', isPrimary: false, title: 'Fixture', color: '#57534e', sessionId: null })
    ])
  })

  it('reads a valid crewAvatar and imageKind, and nulls an invalid avatar', () => {
    const t = new BotStateTracker()
    t.applyProfiles([
      { name: 'a', ui_meta: { 'hermes-bots': { crewAvatar: { type: 'cat', color: '#112233' }, imageKind: 'photo' } } },
      { name: 'b', ui_meta: { 'hermes-bots': { crewAvatar: { type: 'dragon' }, imageKind: 'weird' } } },
      { name: 'c', ui_meta: { 'hermes-bots': { crewAvatar: { type: 'cat', color: 'red' }, imageKind: 'shape' } } },
      { name: 'd' }
    ])
    expect(t.view([]).map(b => [b.avatar, b.imageKind])).toEqual([
      [{ type: 'cat', color: '#112233' }, 'photo'], [null, null], [null, 'shape'], [null, null]
    ])
  })

  it('exposes pinned, role and job on BotView', () => {
    const t = new BotStateTracker()
    t.applyProfiles([
      { name: 'a', description: '  Find papers ', ui_meta: { 'hermes-bots': { pinned: true, role: 'researcher' } } },
      { name: 'b', ui_meta: { 'hermes-bots': { pinned: 'true', role: 'chef' } } },
      { name: 'c', description: 5 as unknown as string }
    ])
    expect(t.view([]).map(b => [b.pinned, b.role, b.job])).toEqual([[true, 'researcher', 'Find papers'], [false, null, ''], [false, null, '']])
  })

  it('falls back to display_name, then the profile name, for the title', () => {
    const t = new BotStateTracker()
    t.applyProfiles([{ name: 'a', display_name: 'Alpha' }, { name: 'b' }])
    expect(t.view([]).map(b => b.title)).toEqual(['Alpha', 'b'])
  })

  it('marks a bot working on message.start and idle after message.complete', () => {
    const t = tracker()
    t.applyEvent({ type: 'message.start', session_id: 'run-1' })
    expect(status(t)).toBe('working')
    t.applyEvent({ type: 'message.complete', session_id: 'run-1' })
    expect(status(t)).toBe('idle')
  })

  it('follows boolean running on session.info', () => {
    const t = tracker()
    t.applyEvent({ type: 'session.info', session_id: 'run-1', payload: { running: true } })
    expect(status(t)).toBe('working')
    t.applyEvent({ type: 'session.info', session_id: 'run-1', payload: { running: false } })
    expect(status(t)).toBe('idle')
  })

  it('treats session.info without a boolean running as a partial patch', () => {
    const t = tracker()
    t.applyEvent({ type: 'message.start', session_id: 'run-1' })
    t.applyEvent({ type: 'session.info', session_id: 'run-1', payload: { model: 'm', title: 't' } })
    t.applyEvent({ type: 'session.info', session_id: 'run-1', payload: { running: null } })
    expect(status(t)).toBe('working')
  })

  it('marks a bot needs_you while it has an open pending request', () => {
    const t = tracker()
    t.applyEvent({ type: 'message.start', session_id: 'run-1' })
    expect(status(t, [open])).toBe('needs_you')
    expect(status(t, [])).toBe('working')
  })

  it('tracks the highest execution_generation per session from top-level stamps and session.info', () => {
    const t = tracker()
    t.applyEvent({ type: 'message.delta', session_id: 'run-1', execution_generation: 2 })
    expect(t.generation('run-1')).toBe(2)
    t.applyEvent({ type: 'message.delta', session_id: 'run-1', execution_generation: 1 })
    expect(t.generation('run-1')).toBe(2)
    t.applyEvent({ type: 'session.info', session_id: 'run-1', payload: { running: true, execution_generation: 4 } })
    expect(t.generation('run-1')).toBe(4)
    expect(t.generation('other')).toBeUndefined()
  })

  it('ignores events for sessions it does not know', () => {
    const t = tracker()
    t.applyEvent({ type: 'message.start', session_id: 'nobody' })
    expect(status(t)).toBe('idle')
  })

  it('derives hidden, setupIncomplete and created for the roster', () => {
    const t = new BotStateTracker()
    t.applyProfiles([
      { name: 'default', ui_meta: null, ui_meta_revisions: {} },
      { name: 'fresh', ui_meta: null, ui_meta_revisions: {} },
      { name: 'noRevisions', ui_meta: null },
      { name: 'done', ui_meta: { 'hermes-bots': { title: 'D', hidden: true, created: 99 } }, ui_meta_revisions: { 'hermes-bots': 2 } }
    ])
    const by = Object.fromEntries(t.view([]).map(b => [b.name, b]))
    expect(by.default).toMatchObject({ setupIncomplete: false, hidden: false, created: null })
    expect(by.fresh).toMatchObject({ setupIncomplete: true, hidden: false, created: null })
    expect(by.noRevisions!.setupIncomplete).toBe(true)
    expect(by.done).toMatchObject({ setupIncomplete: false, hidden: true, created: 99 })
  })

  it('defaults sandbox to off and applies on and partial', () => {
    const t = new BotStateTracker()
    t.applyProfiles([{ name: 'a' }, { name: 'b' }, { name: 'c' }])
    expect(t.view([]).map(b => b.sandbox)).toEqual(['off', 'off', 'off'])
    t.applySandbox(new Map([['b', 'on'], ['c', 'partial']]))
    expect(t.view([]).map(b => b.sandbox)).toEqual(['off', 'on', 'partial'])
  })
})
