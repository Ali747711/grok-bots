import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { crewFetch } from '@/lib/crew-api'

const fetchMock = vi.fn()

/** The RequestInit passed to the most recent fetch call. */
function lastInit(): RequestInit & { headers: Headers } {
  return fetchMock.mock.lastCall![1]
}

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.cookie = 'crew_csrf=; Max-Age=0; Path=/'
})

describe('crewFetch', () => {
  it('adds the csrf header from the cookie on POST', async () => {
    document.cookie = 'crew_csrf=abc'
    await crewFetch('/crew/x', { method: 'POST' })
    expect(lastInit().headers.get('X-Crew-CSRF')).toBe('abc')
    expect(lastInit().credentials).toBe('same-origin')
  })

  it('does not add the csrf header on GET', async () => {
    document.cookie = 'crew_csrf=abc'
    await crewFetch('/crew/x')
    expect(lastInit().headers.has('X-Crew-CSRF')).toBe(false)
  })

  it('redirects to /login on 401', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 401 }))
    const loc = { href: '/' }
    vi.stubGlobal('location', loc)
    const res = await crewFetch('/crew/x')
    expect(res.status).toBe(401)
    expect(loc.href).toBe('/login')
  })
})
