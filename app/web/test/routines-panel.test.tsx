import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { RoutinesPanel } from '@/features/routines/RoutinesPanel'
import type { RoutineView } from '@/features/routines/types'

import { bot } from './fixtures'
import { pickOption } from './select-helpers'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const routine = (over: Partial<RoutineView> = {}): RoutineView => ({
  id: 'r1', bot: 'dev', title: 'Daily digest', instruction: 'Summarise the news', schedule: { kind: 'daily', time: '09:00' },
  scheduleText: '0 9 * * *', timezone: 'Europe/London', deliverToChat: false, enabled: true, nextRunAt: Date.UTC(2026, 10, 9, 9, 0),
  lastRunAt: null, lastStatus: null, lastError: null, running: false, state: 'scheduled', finished: false, triggerOnly: false, ...over
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
    expect(screen.getByText(/Next · Nov 9, 2026/)).toBeInTheDocument()
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
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Routine deleted'))
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
    pickOption('When', 'Weekdays')
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '09:30' } })
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Asia/Tokyo' } })
    fireEvent.click(screen.getByRole('checkbox', { name: /Also post the result in the chat/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'POST /crew/routines?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'POST /crew/routines?bot=dev')[0])).toEqual({
      title: 'Morning brief', instruction: 'Say hello', schedule: { kind: 'weekdays', time: '09:30' }, timezone: 'Asia/Tokyo', deliverToChat: true, runs: 'schedule'
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
    expect(screen.getByRole('checkbox', { name: /Also post the result in the chat/ })).toBeChecked()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Digest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')[0])).toMatchObject({ title: 'Digest', timezone: 'Europe/London', schedule: { kind: 'daily', time: '09:00' } })
  })

  it('keeps Save off and skips the preview until a cron expression is typed', async () => {
    const fn = stub({ [LIST]: () => json([]) })
    open()
    await fill()
    pickOption('When', 'Custom (cron)')
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
    pickOption('When', 'Once, at…')
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

  it('W9: edit sends timezoneChanged only when the zone or schedule changed', async () => {
    const fn = stub({ [LIST]: () => json([routine()]), 'PUT /crew/routines/r1?bot=dev': () => json(routine()) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Digest' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')[0]).timezoneChanged).toBe(false)
  })

  it('W9: a changed zone sends timezoneChanged true', async () => {
    const fn = stub({ [LIST]: () => json([routine()]), 'PUT /crew/routines/r1?bot=dev': () => json(routine()) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Timezone'), { target: { value: 'Asia/Tokyo' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')[0]).timezoneChanged).toBe(true)
  })

  it('W9: a changed schedule sends timezoneChanged true, and create sends none', async () => {
    const fn = stub({ [LIST]: () => json([routine()]), 'PUT /crew/routines/r1?bot=dev': () => json(routine()), 'POST /crew/routines?bot=dev': () => json(routine(), 201) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Time'), { target: { value: '10:15' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')[0]).timezoneChanged).toBe(true)
  })
})

describe('RoutinesPanel finished routines and row errors', () => {
  it('renders routine rows as cards with a pause switch and result badge', async () => {
    stub({ [LIST]: () => json([routine({ lastStatus: 'ok' }), routine({ id: 'r2', title: 'Other', lastStatus: 'blocked_config', lastError: 'no key' })]) })
    open()
    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]).toHaveClass('bg-muted', 'rounded-2xl')
    expect(within(rows[0]!).getByRole('switch', { name: 'Daily digest enabled' })).toBeChecked()
    expect(within(rows[0]!).getByText('OK')).toHaveClass('bg-ok-soft', 'text-ok-ink', 'ring-1', 'ring-border')
    for (const name of ['History', 'Edit', 'Delete']) expect(within(rows[0]!).getByRole('button', { name })).toHaveClass('hover:bg-card', 'dark:hover:bg-card')
    expect(within(rows[1]!).getByText('Config problem')).toHaveClass('bg-warn-soft', 'text-warn-ink')
    expect(within(rows[0]!).getByText(/^Next/)).toHaveClass('label-mono')
  })

  it('W2: a finished routine shows Done with no switch and no Run now', async () => {
    stub({ [LIST]: () => json([routine({ enabled: false, finished: true, state: 'completed', nextRunAt: null })]) })
    open()
    expect(await screen.findByText('Done')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull()
    expect(screen.queryByText('Paused')).toBeNull()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
  })

  it("W2: a failed row action shows the server's message", async () => {
    stub({ [LIST]: () => json([routine()]), 'POST /crew/routines/r1/pause?bot=dev': () => json({ error: 'rejected', message: 'Cannot pause: boom' }, 400) })
    open()
    fireEvent.click(await screen.findByRole('switch', { name: 'Daily digest enabled' }))
    expect(await screen.findByText('Cannot pause: boom')).toBeInTheDocument()
  })

  it('W2: a failed row action without a message uses the generic text', async () => {
    stub({ [LIST]: () => json([routine()]), 'POST /crew/routines/r1/pause?bot=dev': () => json({}, 502) })
    open()
    fireEvent.click(await screen.findByRole('switch', { name: 'Daily digest enabled' }))
    expect(await screen.findByText('Could not change the routine')).toBeInTheDocument()
  })

  it('W2: Run now on a finished routine shows the 409 message', async () => {
    stub({ [LIST]: () => json([routine()]), 'POST /crew/routines/r1/run?bot=dev': () => json({ status: 'finished', message: 'This one-time routine already ran.' }, 409) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }))
    expect(await screen.findByText('This one-time routine already ran.')).toBeInTheDocument()
  })
})

describe('RoutinesPanel event-only routines', () => {
  const choose = () => fireEvent.click(screen.getByRole('radio', { name: 'Only when triggered' }))

  it('creates an event-only routine without a schedule', async () => {
    const fn = stub({ [LIST]: () => json([]), 'POST /crew/routines?bot=dev': () => json(routine({ triggerOnly: true }), 201) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'New routine' }))
    expect(screen.getByRole('radio', { name: 'On a schedule' })).toBeChecked()
    choose()
    expect(screen.queryByRole('combobox', { name: 'When' })).toBeNull()
    expect(screen.queryByLabelText('Timezone')).toBeNull()
    expect(screen.queryByText('Next runs')).toBeNull()
    expect(screen.getByText('Runs only when one of its triggers gets an event. Add triggers after saving.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'On event' } })
    fireEvent.change(screen.getByLabelText('What should it do?'), { target: { value: 'React' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'POST /crew/routines?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'POST /crew/routines?bot=dev')[0])).toMatchObject({ title: 'On event', runs: 'triggered' })
  })

  it('always sends runs: schedule for a scheduled routine', async () => {
    const fn = stub({ [LIST]: () => json([routine()]), 'PUT /crew/routines/r1?bot=dev': () => json(routine()) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('radio', { name: 'On a schedule' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')[0])).toMatchObject({ runs: 'schedule' })
  })

  it('edits an event-only routine starting in Only when triggered', async () => {
    const fn = stub({ [LIST]: () => json([routine({ triggerOnly: true })]), 'PUT /crew/routines/r1?bot=dev': () => json(routine({ triggerOnly: true })) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(screen.getByRole('radio', { name: 'Only when triggered' })).toBeChecked()
    expect(screen.queryByRole('combobox', { name: 'When' })).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'On a schedule' }))
    expect(screen.getByRole('combobox', { name: 'When' })).toHaveTextContent('Every day')
    choose()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')).toHaveLength(1))
    expect(body(callsTo(fn, 'PUT /crew/routines/r1?bot=dev')[0])).toMatchObject({ runs: 'triggered' })
  })

  it('shows an event-only routine with no switch and Run now', async () => {
    stub({ [LIST]: () => json([routine({ triggerOnly: true, enabled: false, nextRunAt: null })]) })
    open()
    expect(await screen.findByText('Only when triggered')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.queryByText('Paused')).toBeNull()
    expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument()
  })

  it('warns how many triggers stop working before deleting', async () => {
    const { RoutineRow } = await import('@/features/routines/RoutineRow')
    const props = { routine: routine(), onChanged: () => {}, onEdit: () => {}, historyOpen: false, onToggleHistory: () => {} }
    const { unmount } = render(<ul><RoutineRow {...props} triggerCount={2} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('This routine has 2 triggers; they will stop working.')).toBeInTheDocument()
    unmount()
    const one = render(<ul><RoutineRow {...props} triggerCount={1} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('This routine has 1 trigger; it will stop working.')).toBeInTheDocument()
    one.unmount()
    render(<ul><RoutineRow {...props} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.queryByText(/This routine has/)).toBeNull()
  })
})
