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
})
