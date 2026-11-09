import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import type { RoutineView } from '@/features/routines/types'
import { TriggerMenu } from '@/features/triggers/TriggerMenu'
import type { TriggerView } from '@/features/triggers/types'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const ID = 'a'.repeat(32)
const routine = { id: 'r1', bot: 'dev', title: 'Daily digest', instruction: 'Do it', timezone: null } as RoutineView
const trigger: TriggerView = {
  id: ID, bot: 'dev', routineId: 'r1', name: 'Issues', source: 'github', events: ['issues'], actions: [], enabled: true, createdAt: 1,
  url: `http://127.0.0.1:7070/hooks/${ID}`, lastEvent: null
}
const onChanged = vi.fn()

function stub(routes: Record<string, () => Promise<Response>>) {
  const fn = vi.fn((url: string, init: RequestInit = {}) => (routes[`${init.method ?? 'GET'} ${url}`] ?? (() => json({})))())
  vi.stubGlobal('fetch', fn)
  return fn
}
const calls = (fn: ReturnType<typeof stub>, key: string) => fn.mock.calls.filter(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${u}` === key)
const openMenu = (r: RoutineView | null = routine) => {
  render(<TriggerMenu trigger={trigger} routine={r} onChanged={onChanged} />)
  const button = screen.getByRole('button', { name: 'Issues actions' })
  fireEvent.pointerDown(button)
  fireEvent.click(button)
}
const pick = async (name: string) => fireEvent.click(await screen.findByRole('menuitem', { name }))
const dialog = () => within(screen.getByRole('alertdialog'))

beforeEach(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(() => Promise.resolve()) }, configurable: true }) })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('TriggerMenu', () => {
  it('sends a test event after a confirmation that says it runs the routine', async () => {
    const fn = stub({ [`POST /crew/triggers/${ID}/test`]: () => json({ httpStatus: 202, event: { outcome: 'started' } }) })
    openMenu()
    await pick('Send test event')
    expect(screen.getByText('Send a test event?')).toBeInTheDocument()
    expect(screen.getByText('This runs the routine (one model call).')).toBeInTheDocument()
    expect(calls(fn, `POST /crew/triggers/${ID}/test`)).toHaveLength(0)
    fireEvent.click(dialog().getByRole('button', { name: 'Send test event' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Test event: Started'))
    expect(calls(fn, `POST /crew/triggers/${ID}/test`)).toHaveLength(1)
    expect(onChanged).toHaveBeenCalled()
  })

  it('disables the confirm button while a test event is in flight', async () => {
    let release: (r: Response) => void = () => {}
    const fn = stub({ [`POST /crew/triggers/${ID}/test`]: () => new Promise<Response>(r => { release = r }) })
    openMenu()
    await pick('Send test event')
    const confirm = dialog().getByRole('button', { name: 'Send test event' })
    fireEvent.click(confirm)
    await waitFor(() => expect(confirm).toBeDisabled())
    fireEvent.click(confirm)
    release(new Response(JSON.stringify({ httpStatus: 202, event: null }), { status: 200 }))
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith('Test event: no answer'))
    expect(calls(fn, `POST /crew/triggers/${ID}/test`)).toHaveLength(1)
  })

  it.each([
    ['started', 'success', 'Started'],
    ['finished', 'success', 'Finished'],
    ['ignored', 'info', 'Ignored by the filter'],
    ['duplicate', 'info', 'Duplicate'],
    ['blocked', 'warning', "Blocked by Hermes's safety check"],
    ['too_many', 'warning', 'Too many events'],
    ['trigger_off', 'warning', 'Trigger off'],
    ['routine_paused', 'warning', 'Routine paused'],
    ['failed', 'warning', 'Failed'],
    ['bad_signature', 'warning', 'Bad signature']
  ] as const)('tones the test toast by outcome: %s -> %s', async (outcome, tone, text) => {
    stub({ [`POST /crew/triggers/${ID}/test`]: () => json({ httpStatus: 200, event: { outcome } }) })
    openMenu()
    await pick('Send test event')
    fireEvent.click(dialog().getByRole('button', { name: 'Send test event' }))
    await waitFor(() => expect(toast[tone]).toHaveBeenCalledWith(`Test event: ${text}`))
    for (const other of ['success', 'info', 'warning'] as const) if (other !== tone) expect(toast[other]).not.toHaveBeenCalled()
  })

  it('shows the server reason when the test fails', async () => {
    stub({ [`POST /crew/triggers/${ID}/test`]: () => json({ error: 'triggers_unavailable' }, 503) })
    openMenu()
    await pick('Send test event')
    fireEvent.click(dialog().getByRole('button', { name: 'Send test event' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Triggers are off: Crew couldn't read its triggers file."))
  })

  it('makes a new secret after confirming and shows it once', async () => {
    stub({ [`POST /crew/triggers/${ID}/secret`]: () => json({ secret: 'fresh-secret' }) })
    openMenu()
    await pick('New secret')
    expect(screen.getByText('The old secret stops working at once. Give the sender the new one.')).toBeInTheDocument()
    fireEvent.click(dialog().getByRole('button', { name: 'Make new secret' }))
    expect(await screen.findByText('fresh-secret')).toBeInTheDocument()
    expect(screen.getByText('The secret is shown once.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByText('fresh-secret')).toBeNull())
  })

  it('warns when the new secret is live but not on disk', async () => {
    stub({ [`POST /crew/triggers/${ID}/secret`]: () => json({ secret: 'fresh-secret', saved: false }) })
    openMenu()
    await pick('New secret')
    fireEvent.click(dialog().getByRole('button', { name: 'Make new secret' }))
    expect(await screen.findByText('fresh-secret')).toBeInTheDocument()
    expect(toast.warning).toHaveBeenCalledWith("Saved for now, but Crew couldn't write it to disk yet.")
  })

  it('deletes after confirming and reloads', async () => {
    const fn = stub({ [`DELETE /crew/triggers/${ID}`]: () => Promise.resolve(new Response(null, { status: 204 })) })
    openMenu()
    await pick('Delete')
    expect(screen.getByText('Delete “Issues”?')).toBeInTheDocument()
    expect(screen.getByText('Events sent to its URL will be refused. Runs already in Hermes stay until Hermes removes them.')).toBeInTheDocument()
    expect(calls(fn, `DELETE /crew/triggers/${ID}`)).toHaveLength(0)
    fireEvent.click(dialog().getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Trigger deleted'))
    expect(onChanged).toHaveBeenCalled()
  })

  it('treats 200 saved:false as deleted, with the disk warning', async () => {
    stub({ [`DELETE /crew/triggers/${ID}`]: () => json({ saved: false }) })
    openMenu()
    await pick('Delete')
    fireEvent.click(dialog().getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Trigger deleted'))
    expect(toast.warning).toHaveBeenCalledWith("Saved for now, but Crew couldn't write it to disk yet.")
  })

  it('offers only Show events and Delete for a trigger whose routine is missing', async () => {
    stub({})
    openMenu(null)
    expect(await screen.findByRole('menuitem', { name: 'Show events' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Send test event' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'New secret' })).toBeNull()
  })
})
