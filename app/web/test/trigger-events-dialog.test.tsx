import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { RoutineView } from '@/features/routines/types'
import { TriggerEventsDialog } from '@/features/triggers/TriggerEventsDialog'
import type { TriggerEvent, TriggerView } from '@/features/triggers/types'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const ID = 'a'.repeat(32)
const EVENTS = `GET /crew/triggers/${ID}/events`
const T0 = Date.UTC(2026, 10, 9, 9, 0)
const routine = { id: 'r1', bot: 'dev', title: 'Daily digest', instruction: 'Do it', timezone: 'Europe/London' } as RoutineView
const trigger = { id: ID, bot: 'dev', routineId: 'r1', name: 'Issues', source: 'github' } as TriggerView
const ev = (over: Partial<TriggerEvent>): TriggerEvent => ({
  id: 'e1', at: T0, deliveryId: null, eventType: 'issues', action: null, outcome: 'finished', jobId: null, runId: null, endedAt: null, detail: null, ...over
})

function stub(routes: Record<string, () => Promise<Response>>) {
  const fn = vi.fn((url: string, init: RequestInit = {}) => (routes[`${init.method ?? 'GET'} ${url}`] ?? (routes[`${init.method ?? 'GET'} ${url.split('?')[0]}*`]) ?? (() => json({})))())
  vi.stubGlobal('fetch', fn)
  return fn
}
const count = (fn: ReturnType<typeof stub>) => fn.mock.calls.filter(([u]) => u === `/crew/triggers/${ID}/events`).length
const show = (r: RoutineView | null = routine) => render(<TriggerEventsDialog open onOpenChange={() => {}} bot="dev" trigger={trigger} routine={r} />)
const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('TriggerEventsDialog', () => {
  it('says so when there are no events', async () => {
    stub({ [EVENTS]: () => json({ events: [] }) })
    show()
    expect(await screen.findByText('No events yet.')).toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Events · Issues' })).toBeInTheDocument()
  })

  it('lists events newest first with time, event, outcome and detail', async () => {
    stub({
      [EVENTS]: () => json({
        events: [
          ev({ id: 'old', at: T0, eventType: 'push', outcome: 'finished' }),
          ev({ id: 'new', at: T0 + 3_600_000, eventType: 'issues', action: 'opened', outcome: 'bad_signature', detail: 'signature does not match' })
        ]
      })
    })
    show()
    expect(await screen.findByText('issues · opened')).toBeInTheDocument()
    expect(screen.getByText('Bad signature')).toBeInTheDocument()
    expect(screen.getByText('signature does not match')).toBeInTheDocument()
    expect(screen.getByText('push')).toBeInTheDocument()
    expect(screen.getByText('Finished')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('issues · opened')
    expect(rows[1]).toHaveTextContent('push')
    expect(rows[0]).toHaveTextContent('10:00')
    expect(screen.queryByRole('button', { name: 'Open run' })).toBeNull()
  })

  it('opens the run transcript and goes back', async () => {
    const fn = stub({
      [EVENTS]: () => json({ events: [ev({ runId: 's1' })] }),
      'GET /api/sessions/s1/messages*': () => json({ messages: [{ id: 1, role: 'user', content: 'hello there' }] })
    })
    show()
    fireEvent.click(await screen.findByRole('button', { name: 'Open run' }))
    expect(await screen.findByText('hello there')).toBeInTheDocument()
    expect(fn.mock.calls.some(([u]) => String(u).startsWith('/api/sessions/s1/messages'))).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Back to events' }))
    expect(await screen.findByText('issues')).toBeInTheDocument()
  })

  it('polls every 5 s while an event is started', async () => {
    vi.useFakeTimers()
    const fn = stub({ [EVENTS]: () => json({ events: [ev({ outcome: 'started' })] }) })
    show()
    await tick(0)
    expect(count(fn)).toBe(1)
    await tick(5000)
    expect(count(fn)).toBe(2)
    await tick(5000)
    expect(count(fn)).toBe(3)
  })

  it('polls every 30 s when nothing is running', async () => {
    vi.useFakeTimers()
    const fn = stub({ [EVENTS]: () => json({ events: [ev({ outcome: 'finished' })] }) })
    show()
    await tick(0)
    expect(count(fn)).toBe(1)
    await tick(29_000)
    expect(count(fn)).toBe(1)
    await tick(1000)
    expect(count(fn)).toBe(2)
  })

  it('does not load while closed', async () => {
    const fn = stub({ [EVENTS]: () => json({ events: [] }) })
    render(<TriggerEventsDialog open={false} onOpenChange={() => {}} bot="dev" trigger={trigger} routine={routine} />)
    await act(async () => {})
    expect(count(fn)).toBe(0)
  })

  it('PF31: an outcome is a neutral pill with a dot on an outlined row, never on a muted or red fill', async () => {
    stub({
      [EVENTS]: () => json({ events: [ev({ id: 'a', outcome: 'bad_signature' }), ev({ id: 'b', at: T0 - 1000, outcome: 'ignored' })] })
    })
    show()
    const failed = await screen.findByText('Bad signature')
    for (const row of screen.getAllByRole('listitem')) {
      // The pill is `bg-raised`: on a `bg-muted` row it disappeared in the light theme.
      expect(row.className).not.toMatch(/bg-muted|bg-raised|bg-destructive/)
      expect(row).toHaveClass('border', 'border-border', 'rounded-2xl')
    }
    expect(failed).toHaveClass('rounded-full', 'bg-raised', 'text-foreground')
    expect(failed.className).not.toMatch(/destructive/)
    expect(failed.querySelector('[aria-hidden="true"]')).toHaveClass('bg-status-error')
    expect(screen.getByText('Ignored by the filter').querySelector('[aria-hidden="true"]')).toHaveClass('bg-status-idle')
    expect(screen.getByRole('heading', { name: 'Events · Issues' })).toHaveClass('text-[15px]', 'font-semibold')
  })
})
