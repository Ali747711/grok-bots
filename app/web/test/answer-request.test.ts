import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { submitAnswer } from '@/features/requests/answer-request'

const fetchMock = vi.fn()
beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock) })
afterEach(() => { vi.unstubAllGlobals(); document.cookie = 'crew_csrf=; Max-Age=0; Path=/' })

const reply = (status: number, body: unknown) => fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status }))

describe('submitAnswer', () => {
  it('posts JSON with the csrf header and returns null when sent', async () => {
    document.cookie = 'crew_csrf=tok'
    reply(202, { status: 'sent' })
    expect(await submitAnswer('srq-1', { choice: 'once' })).toBeNull()
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/crew/requests/srq-1/answer')
    expect(init.method).toBe('POST')
    expect(init.headers.get('X-Crew-CSRF')).toBe('tok')
    expect(init.headers.get('Content-Type')).toBe('application/json')
    expect(JSON.parse(init.body)).toEqual({ choice: 'once' })
  })

  it.each([
    [409, { status: 'already_resolved' }, 'Already answered'],
    [422, { error: 'unsupported', hint: 'answer in the app that asked' }, 'Answer this in the app that asked'],
    [503, { error: 'hermes_offline' }, 'Hermes is offline — try again when it’s back'],
    [404, { error: 'not_found' }, 'This request is no longer waiting'],
    [400, { error: 'bad_choice' }, 'That answer was not accepted']
  ])('maps %i to a plain message', async (status, body, message) => {
    reply(status, body)
    expect(await submitAnswer('x', { choice: 'once' })).toBe(message)
  })

  it('treats an in-progress answer as sent', async () => {
    reply(409, { status: 'answering' })
    expect(await submitAnswer('x', { choice: 'once' })).toBeNull()
  })

  it('reports a network failure without throwing', async () => {
    fetchMock.mockRejectedValue(new TypeError('fail'))
    expect(await submitAnswer('x', { value: 'secret' })).toBe('Could not reach Crew — try again')
  })
})
