import { beforeEach, describe, expect, it } from 'vitest'

import type { BotDeps } from '../src/bots/create.js'
import { sendFirstRun, wantsFirstRun } from '../src/bots/first-run.js'
import { FIRST_RUN_PROMPT } from '../src/voice/copy.js'
import { FakeRest, FakeRpc } from './fake-rpc.js'

let rpc: FakeRpc
let rest: FakeRest
let deps: Pick<BotDeps, 'rpc' | 'rest'>
let stored: unknown[]

beforeEach(() => {
  rpc = new FakeRpc()
  rest = new FakeRest()
  stored = []
  rest.routes.set('GET /api/sessions/s1/messages', () => ({ messages: stored }))
  rpc.handlers.set('session.resume', () => ({ session_id: 'live1' }))
  rpc.handlers.set('prompt.submit', () => ({ ok: true }))
  deps = { rpc: rpc.call, rest: { request: rest.request } as BotDeps['rest'] }
})

describe('sendFirstRun', () => {
  it('resumes the chat and submits one hidden prompt with the first-run text', async () => {
    expect(await sendFirstRun(deps, 'scout', 's1')).toBe('sent')
    expect(rest.requests[0]).toMatchObject({ method: 'GET', path: '/api/sessions/s1/messages', query: { profile: 'scout', limit: '1', order: 'latest' } })
    expect(rpc.of('session.resume').map(c => c.params)).toEqual([{ profile: 'scout', session_id: 's1', omit_messages: true }])
    const submit = rpc.of('prompt.submit')[0]?.params
    expect(submit).toMatchObject({ profile: 'scout', session_id: 'live1', text: FIRST_RUN_PROMPT, display_kind: 'hidden' })
    expect(typeof submit!.submission_id).toBe('string')
  })

  it('skips a chat that already has messages', async () => {
    stored = [{ role: 'user', content: 'hi' }]
    expect(await sendFirstRun(deps, 'scout', 's1')).toBe('skipped')
    expect(rpc.of('prompt.submit')).toEqual([])
  })

  it('the first-run text asks for a short greeting with no tools', () => {
    expect(FIRST_RUN_PROMPT).toContain("don't use any tools")
    expect(FIRST_RUN_PROMPT).toContain('one or two sentences')
  })
})

describe('wantsFirstRun', () => {
  it.each([['scout', undefined, true], ['e2e123', undefined, false], ['e2e123', true, true], ['scout', false, false]] as const)('wantsFirstRun(%s, %s) is %s', (name, requested, expected) => {
    expect(wantsFirstRun(name, requested)).toBe(expected)
  })
})
