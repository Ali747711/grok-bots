import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RoutinesPanel } from '@/features/routines/RoutinesPanel'
import type { RoutineView } from '@/features/routines/types'
import type { TriggerView } from '@/features/triggers/types'

import { bot } from './fixtures'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const routine = (over: Partial<RoutineView> = {}): RoutineView => ({
  id: 'r1', bot: 'dev', title: 'Daily digest', instruction: 'Summarise', schedule: { kind: 'daily', time: '09:00' }, scheduleText: '0 9 * * *',
  timezone: 'Europe/London', deliverToChat: false, enabled: true, nextRunAt: null, lastRunAt: null, lastStatus: null, lastError: null,
  running: false, state: 'scheduled', finished: false, triggerOnly: false, ...over
})
const ID1 = 'a'.repeat(32)
const ID2 = 'b'.repeat(32)
const trig = (over: Partial<TriggerView> = {}): TriggerView => ({
  id: ID1, bot: 'dev', routineId: 'r1', name: 'Issues', source: 'github', events: [], actions: [], enabled: true, createdAt: 1,
  url: `http://127.0.0.1:7070/hooks/${ID1}`, lastEvent: null, ...over
})
const blockedEvent = { id: 'e1', at: 1, deliveryId: null, eventType: 'issues', action: null, outcome: 'blocked' as const, jobId: null, runId: null, endedAt: null, detail: null }

function stub(triggers: TriggerView[], routines: RoutineView[] = [routine()]) {
  const fn = vi.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`
    if (key === 'GET /crew/routines?bot=dev') return json(routines)
    if (key === 'GET /crew/bots/dev/triggers') return json({ triggers })
    if (key.startsWith('PATCH /crew/triggers/')) return json({ ...triggers[0], enabled: false })
    return json({})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
/** Triggers sit in the routine's accordion, so the panel opens with the first row's details shown. */
const open = async () => {
  render(<RoutinesPanel bot={bot({ name: 'dev', title: 'Dev' })} />)
  fireEvent.click((await screen.findAllByRole('button', { name: 'Routine details' }))[0]!)
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('TriggerSection', () => {
  it('shows Triggers (n) and lists name, source, switch and last outcome', async () => {
    stub([trig({ lastEvent: blockedEvent }), trig({ id: ID2, name: 'Pushes', source: 'generic' })])
    await open()
    const toggle = await screen.findByRole('button', { name: 'Triggers (2)' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Issues')).toBeInTheDocument()
    expect(screen.getByText('GitHub')).toBeInTheDocument()
    expect(screen.getByText('Generic')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Issues on' })).toBeChecked()
    expect(screen.getByText("Blocked by Hermes's safety check")).toBeInTheDocument()
    expect(screen.getByText('No events yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add trigger' })).toBeInTheDocument()
  })

  it('keeps Triggers (n) out of a collapsed row', async () => {
    stub([trig()])
    await open()
    await screen.findByRole('button', { name: 'Triggers (1)' })
    fireEvent.click(screen.getByRole('button', { name: 'Routine details' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Triggers \(/ })).toBeNull())
  })

  it('draws a failed outcome as a neutral pill with an error dot, never red on a red tint', async () => {
    const failed = { ...blockedEvent, outcome: 'failed' as const }
    stub([trig({ lastEvent: failed }), trig({ id: ID2, name: 'Pushes', lastEvent: { ...blockedEvent, outcome: 'ignored' as const } })])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Triggers (2)' }))
    const pill = screen.getByText('Failed')
    expect(pill).toHaveClass('rounded-full', 'bg-raised', 'text-foreground')
    expect(pill.className).not.toMatch(/destructive/)
    expect(pill.querySelector('[aria-hidden="true"]')).toHaveClass('bg-status-error')
    const ignored = screen.getByText('Ignored by the filter')
    expect(ignored).toHaveClass('text-muted-foreground')
    expect(ignored.querySelector('[aria-hidden="true"]')).toHaveClass('bg-status-idle')
    expect(screen.getByText('Issues').closest('li')!.firstElementChild).toHaveClass('bg-shell', 'rounded-xl')
  })

  it('says so when a routine has no triggers', async () => {
    stub([])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Triggers (0)' }))
    expect(screen.getByText('No triggers yet.')).toBeInTheDocument()
  })

  it('turns a trigger off with PATCH enabled false', async () => {
    const fn = stub([trig()])
    await open()
    fireEvent.click(await screen.findByRole('button', { name: 'Triggers (1)' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Issues on' }))
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => u === `/crew/triggers/${ID1}` && (i as RequestInit).method === 'PATCH')).toBe(true))
    const call = fn.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'PATCH')!
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ enabled: false })
  })

  it('lists triggers of deleted routines as routine missing', async () => {
    stub([trig({ routineId: 'gone', name: 'Orphan' })])
    await open()
    expect(await screen.findByText('Triggers of deleted routines')).toBeInTheDocument()
    const section = screen.getByText('Triggers of deleted routines').closest('section')!
    expect(within(section).getByText('Orphan')).toBeInTheDocument()
    const missing = within(section).getByText('Routine missing')
    expect(missing).toHaveClass('rounded-full', 'bg-raised', 'text-foreground')
    expect(missing.querySelector('[aria-hidden="true"]')).toHaveClass('bg-status-waiting')
    expect(section).toHaveClass('bg-background', 'rounded-2xl')
  })

  it('shows no orphan section when every trigger has its routine', async () => {
    stub([trig()])
    await open()
    await screen.findByRole('button', { name: 'Triggers (1)' })
    expect(screen.queryByText('Triggers of deleted routines')).toBeNull()
  })

  it('passes the trigger count to the delete warning', async () => {
    stub([trig(), trig({ id: ID2, name: 'Pushes' })])
    await open()
    await screen.findByRole('button', { name: 'Triggers (2)' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('This routine has 2 triggers; they will stop working.')).toBeInTheDocument()
  })
})

describe('trigger list errors', () => {
  it('says why triggers are missing when the list fails', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/crew/bots/dev/triggers' ? json({ error: 'triggers_unavailable' }, 503) : json([routine()]))))
    await open()
    expect(await screen.findByText("Triggers are off: Crew couldn't read its triggers file.")).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Triggers \(/ })).toBeNull()
  })

  it('shows no trigger error when the list loads', async () => {
    stub([trig()])
    await open()
    await screen.findByRole('button', { name: 'Triggers (1)' })
    expect(screen.queryByText(/Triggers are off/)).toBeNull()
  })
})
