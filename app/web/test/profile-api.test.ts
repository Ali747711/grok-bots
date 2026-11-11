import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getApprovals, profileErrorText, setApprovals, sleepChoice } from '@/features/profile/profile-api'
import { ScreenApiError, setIdleStop } from '@/lib/crew-api'
import { CrewApiError } from '@/lib/crew-json'

const fetchMock = vi.fn()
const answer = (body: unknown, status = 200) => fetchMock.mockImplementation(async () => new Response(JSON.stringify(body), { status }))

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('profile-api', () => {
  it('reads and writes approvals on the bot route', async () => {
    answer({ mode: 'smart', isDefault: true, sandboxed: false })
    expect(await getApprovals('scout')).toEqual({ mode: 'smart', isDefault: true, sandboxed: false })
    expect(fetchMock.mock.lastCall![0]).toBe('/crew/bots/scout/approvals')
    expect(fetchMock.mock.lastCall![1].method).toBe('GET')
    answer({ mode: 'manual', isDefault: false, sandboxed: false })
    expect(await setApprovals('scout', 'manual')).toEqual({ mode: 'manual', isDefault: false, sandboxed: false })
    expect(fetchMock.mock.lastCall![0]).toBe('/crew/bots/scout/approvals')
    expect(fetchMock.mock.lastCall![1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual({ mode: 'manual' })
  })

  it('writes the idle stop on the screen config route', async () => {
    answer({ useScreen: false, idleStopMinutes: 60 })
    expect(await setIdleStop('scout', 60)).toEqual({ useScreen: false, idleStopMinutes: 60 })
    expect(fetchMock.mock.lastCall![0]).toBe('/crew/bots/scout/screen/config')
    expect(fetchMock.mock.lastCall![1].method).toBe('PUT')
    expect(JSON.parse(fetchMock.mock.lastCall![1].body)).toEqual({ idleStopMinutes: 60 })
  })

  it('turns each failure into one plain sentence', () => {
    const crew = (status: number, body: Record<string, unknown> | null) => new CrewApiError(status, body)
    expect(profileErrorText(crew(503, { error: 'hermes_offline' }))).toBe('Hermes is offline')
    expect(profileErrorText(crew(400, { error: 'primary_not_supported' }))).toBe('Change this in Hermes for the primary bot')
    expect(profileErrorText(crew(409, { error: 'toolset_locked' }), { title: 'Scout' })).toBe('Off while Scout runs in a sandbox')
    expect(profileErrorText(crew(409, { error: 'toolset_locked' }))).toBe('Off while the bot runs in a sandbox')
    expect(profileErrorText(crew(502, { error: 'hermes_error', message: 'config is read-only' }))).toBe('config is read-only')
    expect(profileErrorText(crew(400, { error: 'rejected', message: 'No such mode' }))).toBe('No such mode')
    // A Crew validation message is not Hermes's text and is never shown.
    expect(profileErrorText(crew(400, { error: 'bad_body', message: 'Too big: expected string <=2000' }))).toBe("Couldn't save. Try again.")
    expect(profileErrorText(crew(502, null))).toBe("Couldn't save. Try again.")
    expect(profileErrorText(new Error('boom'))).toBe("Couldn't save. Try again.")
  })

  it('says why an apps change was refused, in the apps words', () => {
    const crew = (status: number, error: string) => new CrewApiError(status, { error })
    expect(profileErrorText(crew(409, 'level_unavailable'))).toBe("This bot doesn't ask before actions, so it can only read in apps.")
    expect(profileErrorText(crew(409, 'no_key'))).toBe('Set the key in Settings')
    expect(profileErrorText(crew(409, 'key_rejected'))).toBe('Key not accepted')
    expect(profileErrorText(crew(502, 'composio_unavailable'))).toBe("Couldn't reach Composio")
    expect(profileErrorText(crew(502, 'apps_failed'))).toBe("Couldn't save. Try again.")
  })

  it('reads the same sentences from a screen route failure', () => {
    expect(profileErrorText(new ScreenApiError(503, 'hermes_offline', 'Hermes is offline'))).toBe('Hermes is offline')
    expect(profileErrorText(new ScreenApiError(400, 'primary_not_supported', 'Not available for the primary bot'))).toBe('Change this in Hermes for the primary bot')
    expect(profileErrorText(new ScreenApiError(502, 'hermes_error', 'Not enough free memory'))).toBe('Not enough free memory')
    expect(profileErrorText(new ScreenApiError(502, 'some_new_code', 'Something went wrong. Try again.'))).toBe("Couldn't save. Try again.")
  })

  it('says why a setting could not be read with the same mapper', () => {
    const crew = (status: number, body: Record<string, unknown> | null) => new CrewApiError(status, body)
    const read = { read: true }
    expect(profileErrorText(crew(503, { error: 'hermes_offline' }), read)).toBe('Hermes is offline')
    expect(profileErrorText(new ScreenApiError(503, 'hermes_offline', 'Hermes is offline'), read)).toBe('Hermes is offline')
    expect(profileErrorText(crew(502, { error: 'hermes_error', message: 'config unreadable' }), read)).toBe('config unreadable')
    // A screen route's message is already readable text, never a raw code.
    expect(profileErrorText(new ScreenApiError(502, 'some_new_code', 'Something went wrong. Try again.'), read)).toBe('Something went wrong. Try again.')
    // Nothing was being saved, so a read never says "Couldn't save".
    expect(profileErrorText(crew(400, { error: 'bad_body', message: 'Too big' }), read)).toBe("Hermes didn't answer")
    expect(profileErrorText(crew(502, null), read)).toBe("Hermes didn't answer")
    expect(profileErrorText(new Error('unexpected answer'), read)).toBe("Hermes didn't answer")
  })

  it('has one error mapper', async () => {
    expect(Object.keys(await import('@/features/profile/profile-api')).filter(name => /ErrorText$/.test(name))).toEqual(['profileErrorText'])
  })

  it('shows any stored idle stop as one of the three choices (R3)', () => {
    expect(sleepChoice(60)).toBe(60)
    expect(sleepChoice(0)).toBe(0)
    expect(sleepChoice(15)).toBe(15)
    expect(sleepChoice(30)).toBe(15)
    expect(sleepChoice(null)).toBe(15)
  })
})
