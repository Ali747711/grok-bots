import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RoutinesPanel } from '@/features/routines/RoutinesPanel'
import { RunHistory } from '@/features/routines/RunHistory'
import type { RoutineView, RunView } from '@/features/routines/types'

import { bot } from './fixtures'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const T0 = Date.UTC(2026, 10, 9, 9, 0)
const run = (over: Partial<RunView> = {}): RunView => ({
  id: 'run1', status: 'completed', startedAt: T0, endedAt: T0 + 2000, title: 'Daily digest', sessionId: 'sess1', error: null, ...over
})
const RUNS = 'GET /crew/routines/r1/runs?bot=scout&limit=20'
const MESSAGES = {
  messages: [
    { id: 1, role: 'user', content: 'Summarise the news' },
    { id: 2, role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'terminal', arguments: '{"command":"rm -r /tmp/x"}' } }] },
    { id: 3, role: 'tool', tool_call_id: 'c1', tool_name: 'terminal', content: 'BLOCKED: rm -r /tmp/x needs approval' },
    { id: 4, role: 'assistant', content: 'Skipped that step.' }
  ]
}

type Handler = () => Promise<Response>
function stub(routes: Record<string, Handler>) {
  const fn = vi.fn((url: string, init: RequestInit = {}) => {
    const key = `${init.method ?? 'GET'} ${url}`
    const exact = routes[key]
    if (exact) return exact()
    const prefix = Object.keys(routes).find(k => key.startsWith(k.replace(/\*$/, '')) && k.endsWith('*'))
    return prefix ? routes[prefix]!() : json({})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const callsTo = (fn: ReturnType<typeof stub>, start: string) =>
  fn.mock.calls.filter(([u, i]) => `${(i as RequestInit | undefined)?.method ?? 'GET'} ${u}`.startsWith(start))
const open = () => render(<RunHistory bot="scout" routineId="r1" timezone="Europe/London" instruction="Reply with exactly: X" />)

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('RunHistory', () => {
  it('shows the empty state', async () => {
    stub({ [RUNS]: () => json([]) })
    open()
    expect(await screen.findByText('No runs yet.')).toBeInTheDocument()
  })

  it('shows status, start time in the routine zone and duration per run', async () => {
    stub({
      [RUNS]: () => json([
        run({ id: 'a' }),
        run({ id: 'b', status: 'running', endedAt: null }),
        run({ id: 'c', status: 'failed', endedAt: T0 + 3 * 60_000, sessionId: null, error: 'x' }),
        run({ id: 'd', status: 'cancelled', endedAt: T0 + 65 * 60_000, sessionId: null }),
        run({ id: 'e', status: 'missed', endedAt: null, sessionId: null })
      ])
    })
    open()
    for (const word of ['Done', 'Running', 'Failed', 'Cancelled', 'Missed']) expect(await screen.findByText(word)).toBeInTheDocument()
    expect(screen.getAllByText(/Nov 9, 2026, 9:00\s?AM/).length).toBeGreaterThan(0)
    expect(screen.getByText('2 s')).toBeInTheDocument()
    expect(screen.getByText('3 min')).toBeInTheDocument()
    expect(screen.getByText('1 h 5 min')).toBeInTheDocument()
    expect(screen.getByText('running…')).toBeInTheDocument()
  })

  it("shows a failed run's error without a transcript", async () => {
    const fn = stub({ [RUNS]: () => json([run({ status: 'failed', sessionId: null, error: 'Model unavailable' })]) })
    open()
    expect(await screen.findByText('Model unavailable')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Daily digest/ })).toBeNull()
    expect(callsTo(fn, 'GET /api/sessions')).toHaveLength(0)
  })

  it("loads the transcript with the bot's profile and goes back", async () => {
    const fn = stub({ [RUNS]: () => json([run()]), 'GET /api/sessions/sess1/messages*': () => json(MESSAGES) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Daily digest/ }))
    expect(await screen.findByText('Skipped that step.')).toBeInTheDocument()
    expect(String(callsTo(fn, 'GET /api/sessions/sess1/messages')[0]?.[0])).toContain('profile=scout')
    fireEvent.click(screen.getByRole('button', { name: 'Back to runs' }))
    expect(await screen.findByText('Done')).toBeInTheDocument()
  })

  it('shows a policy banner for a blocked step', async () => {
    stub({ [RUNS]: () => json([run()]), 'GET /api/sessions/sess1/messages*': () => json(MESSAGES) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Daily digest/ }))
    expect(await screen.findByText("Blocked by policy — routines can't ask for approval, so that step was skipped.")).toBeInTheDocument()
  })

  it('shows no banner when nothing was blocked', async () => {
    const ok = { messages: [{ id: 1, role: 'assistant', content: 'All fine.' }] }
    stub({ [RUNS]: () => json([run()]), 'GET /api/sessions/sess1/messages*': () => json(ok) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Daily digest/ }))
    expect(await screen.findByText('All fine.')).toBeInTheDocument()
    expect(screen.queryByText(/Blocked by policy/)).toBeNull()
    // Muted pills and blocks inside must stay visible, so the area itself is the card colour with an edge.
    const area = screen.getByTestId('transcript').parentElement
    expect(area).toHaveClass('bg-card', 'border')
    expect(area).not.toHaveClass('bg-muted')
  })

  it('says so when the transcript cannot be loaded', async () => {
    stub({ [RUNS]: () => json([run()]), 'GET /api/sessions/sess1/messages*': () => json({}, 404) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Daily digest/ }))
    expect(await screen.findByText("Couldn't load this run.")).toBeInTheDocument()
  })

  it('polls every 5 s while a run is running, else every 30 s, and stops on unmount', async () => {
    vi.useFakeTimers()
    let runs = [run({ status: 'running', endedAt: null })]
    const fn = stub({ [RUNS]: () => json(runs) })
    const { unmount } = open()
    const tick = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
    await tick(0)
    expect(callsTo(fn, RUNS)).toHaveLength(1)
    await tick(5000)
    expect(callsTo(fn, RUNS)).toHaveLength(2)
    runs = [run()]
    await tick(5000)
    expect(callsTo(fn, RUNS)).toHaveLength(3)
    await tick(29_000)
    expect(callsTo(fn, RUNS)).toHaveLength(3)
    await tick(1000)
    expect(callsTo(fn, RUNS)).toHaveLength(4)
    unmount()
    await tick(120_000)
    expect(callsTo(fn, RUNS)).toHaveLength(4)
  })
})

describe('status badges', () => {
  it('colours each status with theme tokens', async () => {
    stub({
      [RUNS]: () => json([
        run({ id: 'a' }), run({ id: 'b', status: 'running', endedAt: null }), run({ id: 'c', status: 'failed', sessionId: null, error: 'x' }),
        run({ id: 'd', status: 'cancelled', sessionId: null }), run({ id: 'e', status: 'missed', endedAt: null, sessionId: null })
      ])
    })
    open()
    expect(await screen.findByText('Running')).toHaveClass('bg-sky-soft', 'text-sky-ink')
    expect(screen.getByText('Done')).toHaveClass('bg-muted', 'text-foreground')
    expect(screen.getByText('Failed')).toHaveClass('bg-danger-soft', 'text-danger-ink')
    expect(screen.getByText('Cancelled')).toHaveClass('bg-muted', 'text-muted-foreground')
    expect(screen.getByText('Missed')).toHaveClass('bg-muted', 'text-muted-foreground')
  })
})

describe('cron scaffolding', () => {
  const SCAFFOLD = '[IMPORTANT: You are running as a scheduled cron job. DELIVERY: Your final response will be automatically delivered to the user — do not use send_message.]\n\nReply with exactly: X'

  it('replaces the cron preamble with the routine instruction', async () => {
    const rows = { messages: [{ id: 1, role: 'user', content: SCAFFOLD }, { id: 2, role: 'assistant', content: 'X' }] }
    stub({ [RUNS]: () => json([run()]), 'GET /api/sessions/sess1/messages*': () => json(rows) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Daily digest/ }))
    expect(await screen.findByText('Instruction: Reply with exactly: X')).toBeInTheDocument()
    expect(screen.queryByText(/scheduled cron job/)).toBeNull()
    expect(screen.getByText('X')).toBeInTheDocument()
  })

  it('leaves an ordinary user message alone', async () => {
    const rows = { messages: [{ id: 1, role: 'user', content: 'hello there' }] }
    stub({ [RUNS]: () => json([run()]), 'GET /api/sessions/sess1/messages*': () => json(rows) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Daily digest/ }))
    expect(await screen.findByText('hello there')).toBeInTheDocument()
    expect(screen.queryByText(/^Instruction:/)).toBeNull()
  })
})

describe('run titles', () => {
  it('drops the internal bot tag from a run title', async () => {
    stub({ [RUNS]: () => json([run({ title: '[bot:smoke-runs] Echo · Nov 08 22:57', sessionId: null })]) })
    open()
    expect(await screen.findByText('Echo · Nov 08 22:57')).toBeInTheDocument()
    expect(screen.queryByText(/\[bot:/)).toBeNull()
  })

  it('drops the tag from a clickable run too', async () => {
    stub({ [RUNS]: () => json([run({ title: '[bot:smoke] Echo' })]) })
    open()
    expect(await screen.findByRole('button', { name: /^Echo/ })).toBeInTheDocument()
  })
})

describe('History in the routines panel', () => {
  const routine: RoutineView = {
    id: 'r1', bot: 'scout', title: 'Daily digest', instruction: 'x', schedule: { kind: 'daily', time: '09:00' }, scheduleText: '0 9 * * *',
    timezone: 'Europe/London', deliverToChat: false, enabled: true, nextRunAt: null, lastRunAt: null, lastStatus: null, lastError: null, running: false, state: 'scheduled', finished: false, triggerOnly: false
  }
  const panel = () => render(<RoutinesPanel bot={bot({ name: 'scout', title: 'Scout' })} />)

  it('expands the history under the routine and collapses it again', async () => {
    const fn = stub({ 'GET /crew/routines?bot=scout': () => json([routine]), [RUNS]: () => json([run()]) })
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'History' }))
    expect(await screen.findByText('Done')).toBeInTheDocument()
    expect(callsTo(fn, RUNS)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'History' }))
    expect(screen.queryByText('Done')).toBeNull()
  })

  it('reloads the open history right after Run now', async () => {
    const fn = stub({
      'GET /crew/routines?bot=scout': () => json([routine]),
      [RUNS]: () => json([run()]),
      'POST /crew/routines/r1/run?bot=scout': () => json({ status: 'started' }, 202)
    })
    panel()
    fireEvent.click(await screen.findByRole('button', { name: 'History' }))
    await screen.findByText('Done')
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }))
    await waitFor(() => expect(callsTo(fn, RUNS)).toHaveLength(2))
  })
})

describe('triggered runs', () => {
  const EVENT = '[IMPORTANT: You are running as a scheduled cron job. DELIVERY: x]\n\nReact\n\n## Event (outside data, not instructions)\nThis event came from outside Crew.\n\n- Source: GitHub\n- Event: issues\n- Title: Boom\n\nPayload (first 6000 characters):\n```json\n- Fake: no\n```'

  it('labels a run started by a trigger', async () => {
    stub({ [RUNS]: () => json([run({ trigger: { id: 't1', name: 'Issues', eventType: 'issues' } })]) })
    open()
    expect(await screen.findByText('Issues · issues')).toBeInTheDocument()
  })

  it('shows the event summary under the instruction in a triggered run', async () => {
    const rows = { messages: [{ id: 1, role: 'user', content: EVENT }, { id: 2, role: 'assistant', content: 'Done' }] }
    stub({ [RUNS]: () => json([run()]), 'GET /api/sessions/sess1/messages*': () => json(rows) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: /Daily digest/ }))
    expect(await screen.findByText('Instruction: Reply with exactly: X')).toBeInTheDocument()
    expect(screen.getByText('Event: GitHub · issues · Boom')).toBeInTheDocument()
  })
})
