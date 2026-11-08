import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RoutinesPanel } from '@/features/routines/RoutinesPanel'
import type { RoutineView } from '@/features/routines/types'

import { bot } from './fixtures'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const routine = (over: Partial<RoutineView> = {}): RoutineView => ({
  id: 'r1', bot: 'dev', title: 'Daily digest', instruction: 'Summarise the news', schedule: { kind: 'daily', time: '09:00' },
  scheduleText: '0 9 * * *', timezone: 'Europe/London', deliverToChat: false, enabled: true, nextRunAt: Date.UTC(2026, 10, 9, 9, 0),
  lastRunAt: null, lastStatus: null, lastError: null, running: false, ...over
})

type Handler = (init: RequestInit) => Promise<Response>
function stub(routes: Record<string, Handler>) {
  const fn = vi.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`
    const handler = routes[key]
    if (handler) return handler(init)
    if (key === 'POST /crew/routines/preview') return json({ next: [Date.UTC(2026, 10, 9, 9, 0)] })
    return json({})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const callsTo = (fn: ReturnType<typeof stub>, key: string) =>
  fn.mock.calls.filter(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${u}` === key)
const body = (call: unknown[] | undefined) => JSON.parse(String((call?.[1] as RequestInit | undefined)?.body))
const LIST = 'GET /crew/routines?bot=dev'
const open = () => render(<RoutinesPanel bot={bot({ name: 'dev', title: 'Dev' })} />)

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('RoutinesPanel list', () => {
  it('shows the empty state', async () => {
    stub({ [LIST]: () => json([]) })
    open()
    expect(await screen.findByText(/No routines yet/)).toBeInTheDocument()
  })

  it('shows title, schedule text, next run and the last result', async () => {
    stub({ [LIST]: () => json([routine({ lastStatus: 'delivery_failed', lastError: 'boom' })]) })
    open()
    expect(await screen.findByText('Daily digest')).toBeInTheDocument()
    expect(screen.getByText(/Every day at 9:00\s?AM/)).toBeInTheDocument()
    expect(screen.queryByText('0 9 * * *')).toBeNull()
    expect(screen.getByText(/Next: Nov 9, 2026/)).toBeInTheDocument()
    expect(screen.getByText('Delivery failed')).toBeInTheDocument()
  })

  it('pauses and resumes', async () => {
    let enabled = true
    const fn = stub({
      [LIST]: () => json([routine({ enabled })]),
      'POST /crew/routines/r1/pause?bot=dev': () => { enabled = false; return json(routine({ enabled })) },
      'POST /crew/routines/r1/resume?bot=dev': () => { enabled = true; return json(routine({ enabled })) }
    })
    open()
    const toggle = await screen.findByRole('switch', { name: 'Daily digest enabled' })
    expect(toggle).toBeChecked()
    fireEvent.click(toggle)
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Daily digest enabled' })).not.toBeChecked())
    expect(callsTo(fn, 'POST /crew/routines/r1/pause?bot=dev')).toHaveLength(1)
    fireEvent.click(screen.getByRole('switch', { name: 'Daily digest enabled' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Daily digest enabled' })).toBeChecked())
    expect(callsTo(fn, 'POST /crew/routines/r1/resume?bot=dev')).toHaveLength(1)
  })

  it('run now shows Running while the routine runs', async () => {
    let running = false
    stub({
      [LIST]: () => json([routine({ running })]),
      'POST /crew/routines/r1/run?bot=dev': () => { running = true; return json({ status: 'started' }, 202) }
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    expect(await screen.findByText('Running…')).toBeInTheDocument()
  })

  it('run now shows already running', async () => {
    stub({ [LIST]: () => json([routine()]), 'POST /crew/routines/r1/run?bot=dev': () => json({ status: 'already_running' }, 409) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    expect(await screen.findByText('Already running')).toBeInTheDocument()
  })

  it('asks before deleting a routine', async () => {
    const fn = stub({ [LIST]: () => json([routine()]), 'DELETE /crew/routines/r1?bot=dev': () => Promise.resolve(new Response(null, { status: 204 })) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    expect(callsTo(fn, 'DELETE /crew/routines/r1?bot=dev')).toHaveLength(0)
    expect(screen.getByText(/Delete “Daily digest”\?/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(callsTo(fn, 'DELETE /crew/routines/r1?bot=dev')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, delete' }))
    await waitFor(() => expect(callsTo(fn, 'DELETE /crew/routines/r1?bot=dev')).toHaveLength(1))
  })

  it('polls every 20 seconds and stops on unmount', async () => {
    vi.useFakeTimers()
    const fn = stub({ [LIST]: () => json([]) })
    const { unmount } = open()
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(callsTo(fn, LIST)).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(callsTo(fn, LIST)).toHaveLength(2)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(callsTo(fn, LIST)).toHaveLength(2)
  })
})

describe('RoutinesPanel form', () => {
  const fill = async () => {
    fireEvent.click(await screen.findByRole('button', { name: 'New routine' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Morning brief' } })
    fireEvent.change(screen.getByLabelText('What should it do?'), { target: { value: 'Say hello' } })
  }

  it('creates a routine with the chosen schedule, zone and delivery', async () => {
    const fn = stub({ [LIST]: () => json([]), 'POST /crew/routines?bot=dev': () => json(routine(), 201) })
    open()
    await fill()
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'weekdays' } })
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:30' } })
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Asia/Tokyo' } })
    fireEvent.click(screen.getByLabelText(/Also post the result in the chat/))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'POST /crew/routines?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'POST /crew/routines?bot=dev')[0])).toEqual({
      title: 'Morning brief', instruction: 'Say hello', schedule: { kind: 'weekdays', time: '09:30' }, timezone: 'Asia/Tokyo', deliverToChat: true
    })
    await waitFor(() => expect(screen.queryByLabelText('Title')).toBeNull())
  })

  it('shows the next runs preview in the chosen zone', async () => {
    stub({ [LIST]: () => json([]) })
    open()
    await fill()
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Asia/Tokyo' } })
    expect(await screen.findByText(/Nov 9, 2026, 6:00\s?PM/)).toBeInTheDocument()
  })

  it('shows the preview error in place and still lets the user save', async () => {
    stub({ [LIST]: () => json([]), 'POST /crew/routines/preview': () => json({ error: 'in_past', message: 'That time has passed' }, 400) })
    open()
    await fill()
    expect(await screen.findByText('That time has passed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it("shows the server's rejection under the form", async () => {
    stub({ [LIST]: () => json([]), 'POST /crew/routines?bot=dev': () => json({ error: 'rejected', message: 'Blocked: prompt injection' }, 400) })
    open()
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Blocked: prompt injection')).toBeInTheDocument()
    expect(screen.getByLabelText('Title')).toHaveValue('Morning brief')
  })

  it('edits a routine with PUT, starting from its values', async () => {
    const fn = stub({ [LIST]: () => json([routine({ deliverToChat: true })]), 'PUT /crew/routines/r1?bot=dev': () => json(routine()) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByLabelText('Title')).toHaveValue('Daily digest')
    expect(screen.getByLabelText('Timezone')).toHaveValue('Europe/London')
    expect(screen.getByLabelText(/Also post the result in the chat/)).toBeChecked()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Digest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')[0])).toMatchObject({ title: 'Digest', timezone: 'Europe/London', schedule: { kind: 'daily', time: '09:00' } })
  })

  it('keeps Save off and skips the preview until a cron expression is typed', async () => {
    const fn = stub({ [LIST]: () => json([]) })
    open()
    await fill()
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'cron' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await new Promise(r => setTimeout(r, 450))
    const previews = () => callsTo(fn, 'POST /crew/routines/preview').map(c => body(c).schedule.kind)
    expect(previews()).not.toContain('cron')
    fireEvent.change(screen.getByLabelText('Cron expression'), { target: { value: '*/5 * * * *' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    await waitFor(() => expect(previews()).toContain('cron'))
  })

  it('keeps Save off until the date of a one-time routine is set', async () => {
    stub({ [LIST]: () => json([]) })
    open()
    await fill()
    fireEvent.change(screen.getByLabelText('When'), { target: { value: 'once_at' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Date and time'), { target: { value: '2026-12-01T08:15' } })
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('never shows raw validation text for a bad body', async () => {
    stub({ [LIST]: () => json([]), 'POST /crew/routines?bot=dev': () => json({ error: 'bad_body', message: 'Invalid string: must match pattern' }, 400) })
    open()
    await fill()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText("Some fields aren't filled in correctly.")).toBeInTheDocument()
    expect(screen.queryByText(/Invalid string/)).toBeNull()
  })
})
