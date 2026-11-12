import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RoutinesPanel } from '@/features/routines/RoutinesPanel'
import type { RoutineView } from '@/features/routines/types'

import { bot } from './fixtures'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const routine = (over: Partial<RoutineView> = {}): RoutineView => ({
  id: 'r1', bot: 'dev', title: 'Daily digest', instruction: 'Summarise the news', schedule: { kind: 'daily', time: '09:00' },
  scheduleText: '0 9 * * *', timezone: 'Europe/London', deliverToChat: false, enabled: true, nextRunAt: Date.UTC(2026, 10, 9, 9, 0),
  lastRunAt: null, lastStatus: null, lastError: null, running: false, state: 'scheduled', finished: false, triggerOnly: false, ...over
})

const LIST = 'GET /crew/routines?bot=dev'
const TRIGGERS = 'GET /crew/bots/dev/triggers'
function stub(routes: Record<string, () => Promise<Response>>) {
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => (routes[`${init.method ?? 'GET'} ${url}`] ?? (() => json({})))()))
}
const open = () => render(<RoutinesPanel bot={bot({ name: 'dev', title: 'Dev' })} />)
const details = async () => fireEvent.click((await screen.findAllByRole('button', { name: 'Routine details' }))[0]!)

afterEach(() => { vi.unstubAllGlobals() })

describe('RoutineRow accordion', () => {
  it('shows title, schedule, next run, last result and Run now without expanding', async () => {
    stub({ [LIST]: () => json([routine({ lastStatus: 'delivery_failed', lastError: 'boom' })]) })
    open()
    expect(await screen.findByText('Daily digest')).toBeInTheDocument()
    expect(screen.getByText(/Every day at 9:00\s?AM/)).toBeInTheDocument()
    expect(screen.queryByText('0 9 * * *')).toBeNull()
    expect(screen.getByText(/Next · Nov 9, 2026/)).toBeInTheDocument()
    expect(screen.getByText('Delivery failed')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Run now' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Routine details' })).toHaveAttribute('aria-expanded', 'false')
    for (const name of ['Edit', 'History', 'Delete', /^Triggers \(/]) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('shows the switch, Edit, History, Delete and Triggers only after Routine details', async () => {
    stub({ [LIST]: () => json([routine()]), [TRIGGERS]: () => json({ triggers: [] }) })
    open()
    const toggle = await screen.findByRole('button', { name: 'Routine details' })
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const row = screen.getByRole('listitem')
    expect(within(row).getByRole('switch', { name: 'Daily digest enabled' })).toBeChecked()
    for (const name of ['Edit', 'History', 'Delete', 'Run now']) expect(within(row).getByRole('button', { name })).toBeInTheDocument()
    expect(await within(row).findByRole('button', { name: 'Triggers (0)' })).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Run now' })).toBeInTheDocument()
  })

  it('never shows a switch for a trigger-only routine, even expanded', async () => {
    stub({ [LIST]: () => json([routine({ triggerOnly: true, enabled: false, nextRunAt: null })]) })
    open()
    await details()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(screen.getByText('Only when triggered')).toBeInTheDocument()
  })

  it('names the open details region after the routine and keeps each row to its own state', async () => {
    stub({ [LIST]: () => json([routine(), routine({ id: 'r2', title: 'Other' })]) })
    open()
    const toggles = await screen.findAllByRole('button', { name: 'Routine details' })
    fireEvent.click(toggles[1]!)
    expect(toggles[0]).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('group', { name: 'Other details' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Other enabled' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Daily digest enabled' })).toBeNull()
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveAttribute('data-open', 'false')
    expect(rows[1]).toHaveAttribute('data-open', 'true')
  })

  it('draws rows as wells and the last result as a neutral pill with a status dot', async () => {
    stub({ [LIST]: () => json([routine({ lastStatus: 'ok' }), routine({ id: 'r2', title: 'Other', lastStatus: 'blocked_config', lastError: 'no key' }), routine({ id: 'r3', title: 'Third', lastStatus: 'error', lastError: 'boom' })]) })
    open()
    const rows = await screen.findAllByRole('listitem')
    expect(rows[0]).toHaveClass('bg-background')
    const dotOf = (pill: HTMLElement) => pill.querySelector('[aria-hidden="true"]')
    const pills = [within(rows[0]!).getByText('OK'), within(rows[1]!).getByText('Config problem'), within(rows[2]!).getByText('Error')]
    for (const pill of pills) {
      expect(pill).toHaveClass('rounded-full', 'bg-raised', 'text-foreground')
      expect(pill.className).not.toMatch(/destructive/)
    }
    expect(dotOf(pills[0]!)).toHaveClass('bg-status-working')
    expect(dotOf(pills[1]!)).toHaveClass('bg-status-waiting')
    expect(dotOf(pills[2]!)).toHaveClass('bg-status-error')
    expect(pills[2]).toHaveAttribute('title', 'boom')
    expect(within(rows[0]!).getByText(/^Next/)).toHaveClass('text-xs', 'text-muted-foreground')
  })
})
