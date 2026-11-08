import { describe, expect, it } from 'vitest'

import { applyFrame, initialTurnState, type TurnFrame, type TurnState } from '@/chat/turn-reducer'

import captured from './fixtures/turn-frames.json'

const frames = captured as unknown as TurnFrame[]
const play = (state: TurnState, list: readonly TurnFrame[]) => list.reduce(applyFrame, state)
const find = (type: string) => frames.find(f => f.type === type)!
const withPayload = (frame: TurnFrame, payload: Record<string, unknown>): TurnFrame => ({
  ...frame,
  payload: { ...(frame.payload as object), ...payload }
})
const assistantText = (s: TurnState) => s.items.filter(i => i.kind === 'assistant').map(i => (i as { text: string }).text)

describe('turn reducer (captured fixture turn)', () => {
  it('has the frames the reducer rules rely on', () => {
    const types = new Set(frames.map(f => f.type))
    for (const t of ['message.start', 'message.delta', 'tool.start', 'tool.complete', 'message.complete']) expect(types).toContain(t)
  })

  it('replays the captured turn into one user-visible reply and one work block', () => {
    const state = play(initialTurnState, frames)
    expect(state.running).toBe(false)
    expect(state.items.filter(i => i.kind === 'work')).toHaveLength(1)
    expect(assistantText(state)).toEqual([(find('message.complete').payload as { text: string }).text])
    const work = state.items.find(i => i.kind === 'work')
    expect(work).toMatchObject({ steps: [{ name: 'terminal', summary: 'echo crew-fixture-ok', running: false }] })
    expect(state.items.some(i => i.kind === 'notice')).toBe(false)
  })

  it('builds the reply text from deltas before the turn completes', () => {
    const beforeComplete = frames.slice(0, frames.findIndex(f => f.type === 'message.complete'))
    const state = play(initialTurnState, beforeComplete)
    expect(state.running).toBe(true)
    expect(assistantText(state).join('').trim()).toContain('crew-fixture-ok` ran with exit code 0')
  })

  it('replayed frames do not duplicate text or steps', () => {
    const once = play(initialTurnState, frames)
    const twice = play(once, frames.map(f => ({ ...f, replayed: true })))
    expect(twice.items).toEqual(once.items)
    const partial = frames.slice(0, frames.findIndex(f => f.type === 'message.complete'))
    const doubled = play(play(initialTurnState, partial), partial)
    expect(assistantText(doubled)).toEqual(assistantText(play(initialTurnState, partial)))
  })

  it('appends only the unseen tail of an overlapping delta', () => {
    const start = find('message.start')
    const d = frames.find(f => f.type === 'message.delta' && (f.payload as { text: string | null }).text)!
    const base = (d.payload as { turn_id: string; segment: number })
    const mk = (text: string, offset: number): TurnFrame => ({ ...d, payload: { text, turn_id: base.turn_id, segment: base.segment, offset } })
    const state = play(initialTurnState, [start, mk('Hello', 0), mk('lo world', 3)])
    expect(assistantText(state).join('')).toBe('Hello world')
  })

  it('ignores frames from an older generation', () => {
    const state = play(initialTurnState, frames)
    const old = { ...find('message.start'), execution_generation: (state.generation ?? 0) - 1 }
    const oldDelta = { ...frames.find(f => f.type === 'message.delta' && (f.payload as { text: string | null }).text)!, execution_generation: state.generation - 1 }
    expect(applyFrame(applyFrame(state, old), oldDelta)).toEqual(state)
  })

  it('shows an error notice when the turn completes with status error', () => {
    const complete = withPayload(find('message.complete'), { status: 'error', error_surface: 'Model call failed', text: '' })
    const state = play(initialTurnState, [...frames.slice(0, frames.findIndex(f => f.type === 'message.complete')), complete])
    expect(state.running).toBe(false)
    expect(state.items.at(-1)).toMatchObject({ kind: 'notice', text: expect.stringContaining('Model call failed') })
  })

  it('marks the turn Stopped when interrupted', () => {
    const complete = withPayload(find('message.complete'), { interrupted: true, status: 'interrupted', outcome: 'interrupted' })
    const state = play(initialTurnState, [find('message.start'), find('tool.start'), complete])
    expect(state.running).toBe(false)
    expect(state.items.at(-1)).toMatchObject({ kind: 'notice', text: 'Stopped' })
    const work = state.items.find(i => i.kind === 'work')
    expect(work).toMatchObject({ steps: [{ running: false }] })
  })

  it('upserts tool steps by tool_id and keeps them in order', () => {
    const start = find('tool.start')
    const complete = find('tool.complete')
    const other = (id: string, name: string): TurnFrame => withPayload(start, { tool_id: id, tool_call_id: id, name, context: name })
    const mid = play(initialTurnState, [find('message.start'), start, other('t2', 'read_file')])
    const work = mid.items.find(i => i.kind === 'work')
    expect(work).toMatchObject({ steps: [{ running: true }, { name: 'read_file', running: true }] })
    const done = applyFrame(mid, complete)
    const steps = (done.items.find(i => i.kind === 'work') as { steps: { name: string; running: boolean; detail?: string }[] }).steps
    expect(steps.map(s => s.name)).toEqual(['terminal', 'read_file'])
    expect(steps[0]).toMatchObject({ running: false })
    expect(steps[0]?.detail).toContain('crew-fixture-ok')
    expect(steps[1]?.running).toBe(true)
  })

  it('shows transient status for tool.generating and thinking, and ignores agent.step', () => {
    const afterStart = applyFrame(initialTurnState, find('message.start'))
    const gen = applyFrame(afterStart, find('tool.generating'))
    expect(gen.status).toContain('terminal')
    expect(gen.items).toEqual(afterStart.items)
    expect(applyFrame(afterStart, find('agent.step'))).toEqual(afterStart)
  })

  it('puts an interim message in its own assistant item', () => {
    const interim: TurnFrame = { ...find('message.start'), type: 'message.interim', payload: { text: 'Working on it' } }
    const state = play(initialTurnState, [find('message.start'), interim])
    expect(assistantText(state)).toContain('Working on it')
  })
})
