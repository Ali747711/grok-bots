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
const open = () => render(<RoutinesPanel bot={bot({ name: 'dev', title: 'Dev' })} />)

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('TriggerSection', () => {
  it('shows Triggers (n) and lists name, source, switch and last outcome', async () => {
    stub([trig({ lastEvent: blockedEvent }), trig({ id: ID2, name: 'Pushes', source: 'generic' })])
    open()
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

  it('says so when a routine has no triggers', async () => {
    stub([])
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Triggers (0)' }))
    expect(screen.getByText('No triggers yet.')).toBeInTheDocument()
  })

  it('turns a trigger off with PATCH enabled false', async () => {
    const fn = stub([trig()])
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Triggers (1)' }))
    fireEvent.click(screen.getByRole('switch', { name: 'Issues on' }))
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => u === `/crew/triggers/${ID1}` && (i as RequestInit).method === 'PATCH')).toBe(true))
    const call = fn.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'PATCH')!
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ enabled: false })
  })

  it('lists triggers of deleted routines as routine missing', async () => {
    stub([trig({ routineId: 'gone', name: 'Orphan' })])
    open()
    expect(await screen.findByText('Triggers of deleted routines')).toBeInTheDocument()
    const section = screen.getByText('Triggers of deleted routines').closest('section')!
    expect(within(section).getByText('Orphan')).toBeInTheDocument()
    expect(within(section).getByText('Routine missing')).toBeInTheDocument()
  })

  it('shows no orphan section when every trigger has its routine', async () => {
    stub([trig()])
    open()
    await screen.findByRole('button', { name: 'Triggers (1)' })
    expect(screen.queryByText('Triggers of deleted routines')).toBeNull()
  })

  it('passes the trigger count to the delete warning', async () => {
    stub([trig(), trig({ id: ID2, name: 'Pushes' })])
    open()
    await screen.findByRole('button', { name: 'Triggers (2)' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText('This routine has 2 triggers; they will stop working.')).toBeInTheDocument()
  })
})
