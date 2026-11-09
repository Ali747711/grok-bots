import { afterEach, describe, expect, it, vi } from 'vitest'

import { CrewApiError } from '@/lib/crew-json'
import {
  createTrigger, deleteTrigger, listTriggerEvents, listTriggers, newSecret, sendTestEvent, triggerErrorText, updateTrigger
} from '@/features/triggers/triggers-api'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const ID = 'a'.repeat(32)
function stub(res: () => Response) {
  const fn = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(res()))
  vi.stubGlobal('fetch', fn)
  return fn
}
const call = (fn: ReturnType<typeof stub>) => ({ url: fn.mock.calls[0]![0], method: fn.mock.calls[0]![1]?.method, body: fn.mock.calls[0]![1]?.body })

afterEach(() => vi.unstubAllGlobals())

describe('triggers api', () => {
  it('lists a bot\'s triggers', async () => {
    const fn = stub(() => json({ triggers: [{ id: ID }] }))
    expect(await listTriggers('dev bot')).toEqual([{ id: ID }])
    expect(call(fn)).toMatchObject({ url: '/crew/bots/dev%20bot/triggers', method: 'GET' })
  })

  it('creates a trigger', async () => {
    const fn = stub(() => json({ trigger: {}, secret: 's', url: 'u' }, 201))
    const input = { routineId: 'r1', name: 'N', source: 'generic' as const, events: [], actions: [] }
    expect(await createTrigger('dev', input)).toMatchObject({ secret: 's' })
    expect(call(fn)).toMatchObject({ url: '/crew/bots/dev/triggers', method: 'POST', body: JSON.stringify(input) })
  })

  it('patches, rotates the secret, lists events and sends a test event', async () => {
    let fn = stub(() => json({ id: ID }))
    await updateTrigger(ID, { enabled: false })
    expect(call(fn)).toMatchObject({ url: `/crew/triggers/${ID}`, method: 'PATCH', body: '{"enabled":false}' })
    fn = stub(() => json({ secret: 'new' }))
    expect(await newSecret(ID)).toEqual({ secret: 'new' })
    expect(call(fn)).toMatchObject({ url: `/crew/triggers/${ID}/secret`, method: 'POST' })
    fn = stub(() => json({ events: [{ id: 'e1' }] }))
    expect(await listTriggerEvents(ID)).toEqual([{ id: 'e1' }])
    expect(call(fn)).toMatchObject({ url: `/crew/triggers/${ID}/events`, method: 'GET' })
    fn = stub(() => json({ httpStatus: 202, event: null }))
    expect(await sendTestEvent(ID)).toEqual({ httpStatus: 202, event: null })
    expect(call(fn)).toMatchObject({ url: `/crew/triggers/${ID}/test`, method: 'POST' })
  })

  it('deletes: 204 and 200 {saved:false} are both success', async () => {
    let fn = stub(() => new Response(null, { status: 204 }))
    expect(await deleteTrigger(ID)).toEqual({})
    expect(call(fn)).toMatchObject({ url: `/crew/triggers/${ID}`, method: 'DELETE' })
    fn = stub(() => json({ saved: false }))
    expect(await deleteTrigger(ID)).toEqual({ saved: false })
  })

  it('words every error code', () => {
    const err = (status: number, error?: string) => new CrewApiError(status, error ? { error } : null)
    expect(triggerErrorText(err(400, 'bad_body'))).toBe("Some fields aren't filled in correctly.")
    expect(triggerErrorText(err(404, 'routine_not_found'))).toBe('That routine no longer exists.')
    expect(triggerErrorText(err(404, 'not_found'))).toBe('That trigger no longer exists.')
    expect(triggerErrorText(err(503, 'hermes_offline'))).toBe('Hermes is offline')
    expect(triggerErrorText(err(503, 'triggers_unavailable'))).toBe("Triggers are off: Crew couldn't read its triggers file.")
    expect(triggerErrorText(err(500, 'internal'))).toBe('Something went wrong. Try again.')
    expect(triggerErrorText(new Error('x'))).toBe('Something went wrong. Try again.')
  })
})
