import { describe, expect, it } from 'vitest'

import { openBotChat } from '@/chat/open-bot-chat'

import { FakeClient } from './fake-client'
import { bot } from './fixtures'

const resumed = { session_id: 'live-1', execution_generation: 4, running: true }

describe('openBotChat', () => {
  it('resumes the canonical chat by resolved_id when the roster has one', async () => {
    const client = new FakeClient()
    client.handlers['session.resume'] = () => resumed
    await openBotChat(client, bot({ name: 'default', sessionId: 'tip-1' }))
    expect(client.calls[0]).toEqual({
      method: 'session.resume',
      params: { profile: 'default', session_id: 'tip-1', omit_messages: true }
    })
  })

  it('returns the snapshot session id, generation and running flag', async () => {
    const client = new FakeClient()
    client.handlers['session.resume'] = () => resumed
    expect(await openBotChat(client, bot({ name: 'default', sessionId: 'tip-1' }))).toEqual({ sessionId: 'live-1', generation: 4, running: true })
  })

  it('creates via session.create when the bot has no chat yet', async () => {
    const client = new FakeClient()
    client.handlers['session.create'] = () => ({ session_id: 'new-1' })
    const result = await openBotChat(client, bot({ name: 'crew-test' }))
    expect(client.calls[0]).toEqual({
      method: 'session.create',
      params: { profile: 'crew-test', title: 'Bot Chat', hidden: true, follow_profile_config: true }
    })
    expect(result).toEqual({ sessionId: 'new-1', generation: 0, running: false })
  })

  it('never creates when resume fails', async () => {
    const client = new FakeClient()
    client.handlers['session.resume'] = () => { throw new Error('boom') }
    await expect(openBotChat(client, bot({ name: 'default', sessionId: 'tip-1' }))).rejects.toThrow('boom')
    expect(client.callsOf('session.create')).toHaveLength(0)
  })
})
