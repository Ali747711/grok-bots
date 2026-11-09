import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { GroupRpc } from '../src/groups/group-rpc.js'
import { startGroupWatcher, type GroupWatcher } from '../src/groups/group-watcher.js'
import type { HermesDriverStatus, HermesRoom, HermesRoomState } from '../src/groups/types.js'

const mkRoom = (id: string, updated: number, seq: number): HermesRoom => ({
  room_id: id, name: id, members: [], authority_epoch: 1, revision: 1, created_at: 1, updated_at: updated, latest_seq: seq
})
const idle: HermesDriverStatus = { working: false, blocked: false, pending_actions: [], member_activity: [], max_rounds: 3, max_continues: 5 }
const busy = (progress: number): HermesDriverStatus => ({ ...idle, working: true, member_activity: [{ member_id: 'a', status: 'running', started_at: 1, progress_at: progress }] })

let rooms: HermesRoom[]
let statuses: Record<string, HermesDriverStatus>
let calls: string[]
let rpc: GroupRpc
let watcher: GroupWatcher | undefined
let connected: boolean
let connListener: ((c: boolean) => void) | undefined
let caps: { driver: boolean; seatable_profiles: string[] }

const start = () => {
  watcher = startGroupWatcher({
    rpc,
    connected: () => connected,
    onConnectionChange: l => { connListener = l; return () => { connListener = undefined } },
    now: () => Date.now()
  })
  return watcher
}
const stateFor = async (id: string): Promise<HermesRoomState> => {
  calls.push(`state:${id}`)
  const room = rooms.find(r => r.room_id === id)
  if (!room) throw new Error('gone')
  return { room, context: { purpose: '', notes: '', routing: 'everyone', lead_member_id: '' }, driver_status: statuses[id] ?? idle }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_000_000)
  rooms = []
  statuses = {}
  calls = []
  connected = true
  caps = { driver: true, seatable_profiles: ['b', 'a'] }
  rpc = {
    capabilities: async () => { calls.push('caps'); return caps },
    list: async () => { calls.push('list'); return rooms },
    state: stateFor,
    log: async (id, since, limit) => { calls.push(`log:${id}:${since}:${limit}`); return { events: [], cursor: 0, latest_seq: 0, has_more: false, authority: { epoch: 1 } } }
  } as unknown as GroupRpc
})
afterEach(() => { watcher?.stop(); watcher = undefined; vi.useRealTimers() })

describe('group watcher', () => {
  it('marks groups unavailable when the driver is off', async () => {
    caps = { driver: false, seatable_profiles: [] }
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.state().available).toBe(false)
    expect(calls).toEqual(['caps'])
  })

  it('lists rooms, fetches state for new rooms, sorted by updated_at desc, seatable sorted', async () => {
    rooms = [mkRoom('old', 10, 0), mkRoom('new', 20, 0)]
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toEqual(['caps', 'list', 'state:old', 'state:new'])
    expect(w.state().rooms.map(r => r.id)).toEqual(['new', 'old'])
    expect(w.state().seatable).toEqual(['a', 'b'])
    expect(w.state().available).toBe(true)
  })

  it('polls active rooms every 2 s and idle rooms only on change', async () => {
    rooms = [mkRoom('act', 10, 0), mkRoom('idl', 10, 0)]
    statuses = { act: busy(5) }
    start()
    await vi.advanceTimersByTimeAsync(0)
    calls.length = 0
    await vi.advanceTimersByTimeAsync(2000)
    expect(calls).toEqual(['state:act'])
    calls.length = 0
    rooms = [mkRoom('act', 10, 0), mkRoom('idl', 11, 0)]
    await vi.advanceTimersByTimeAsync(3000)
    expect(calls).toContain('state:idl')
  })

  it('fetches the tail only when latest_seq moves', async () => {
    rooms = [mkRoom('r', 10, 30)]
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toContain('log:r:10:20')
    calls.length = 0
    await w.refreshRoom('r')
    expect(calls).toEqual(['state:r'])
    rooms = [mkRoom('r', 11, 5 + 30)]
    await w.refreshRoom('r')
    expect(calls).toEqual(['state:r', 'state:r', 'log:r:15:20'])
  })

  it('shows a renamed state room before the next list tick', async () => {
    rooms = [mkRoom('r', 10, 0)]
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.state().rooms[0]?.name).toBe('r')
    rpc.state = async id => ({ room: { ...mkRoom(id, 11, 0), name: 'New', revision: 2 }, driver_status: idle })
    await w.refreshRoom('r')
    expect(w.state().rooms[0]?.name).toBe('New')
  })

  it('uses a zero lower bound for short logs', async () => {
    rooms = [mkRoom('r', 10, 3)]
    start()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls).toContain('log:r:0:20')
  })

  it('drops a room that disappears and its pending actions', async () => {
    rooms = [mkRoom('r', 10, 0)]
    statuses = { r: { ...idle, pending_actions: [{ kind: 'retry', member_id: 'a', task_id: 't', execution_generation: 1 }] } }
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.pendingActions().get('r')).toHaveLength(1)
    rooms = []
    await vi.advanceTimersByTimeAsync(5000)
    expect(w.state().rooms).toEqual([])
    expect(w.pendingActions().has('r')).toBe(false)
  })

  it('keeps the last view and last pending actions when a call fails', async () => {
    rooms = [mkRoom('r', 10, 0)]
    statuses = { r: { ...busy(5), pending_actions: [{ kind: 'discard', member_id: 'a', task_id: 't', execution_generation: 1 }] } }
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    const before = JSON.stringify(w.state())
    rpc.state = async () => { throw new Error('boom') }
    await vi.advanceTimersByTimeAsync(2000)
    expect(JSON.stringify(w.state())).toBe(before)
    expect(w.pendingActions().get('r')).toHaveLength(1)
  })

  it('never runs two calls for the same room at once', async () => {
    rooms = [mkRoom('r', 10, 0)]
    start()
    await vi.advanceTimersByTimeAsync(0)
    let inFlight = 0
    let max = 0
    let release: () => void = () => undefined
    const gate = new Promise<void>(r => { release = r })
    rpc.state = async id => {
      inFlight++
      max = Math.max(max, inFlight)
      await gate
      inFlight--
      return stateFor(id)
    }
    const a = watcher!.refreshRoom('r')
    const b = watcher!.refreshRoom('r')
    await vi.advanceTimersByTimeAsync(0)
    expect(inFlight).toBe(1)
    release()
    await Promise.all([a, b])
    expect(max).toBe(1)
  })

  it('fires onChange only on visible changes', async () => {
    rooms = [mkRoom('r', 10, 0)]
    statuses = { r: busy(5) }
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    const fn = vi.fn()
    w.onChange(fn)
    statuses = { r: busy(6) }
    await w.refreshRoom('r')
    expect(fn).not.toHaveBeenCalled()
    statuses = { r: idle }
    await w.refreshRoom('r')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('makes no calls while disconnected, keeps state, and reconnects with capabilities then list', async () => {
    rooms = [mkRoom('r', 10, 0)]
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    connected = false
    connListener?.(false)
    calls.length = 0
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toEqual([])
    expect(w.state().rooms).toHaveLength(1)
    connected = true
    connListener?.(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.slice(0, 2)).toEqual(['caps', 'list'])
  })

  it('ignores a late state reply for a room that was dropped meanwhile', async () => {
    rooms = [mkRoom('r', 10, 0)]
    statuses = { r: busy(5) }
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    let release: () => void = () => undefined
    const gate = new Promise<void>(res => { release = res })
    const approval = { kind: 'approval' as const, member_id: 'a', task_id: 't', execution_generation: 1, session_id: 's', request_id: 'q', approval: {} }
    rpc.state = async id => {
      const room = rooms[0] ?? mkRoom(id, 10, 0)
      await gate
      return { room, driver_status: { ...busy(6), pending_actions: [approval] } }
    }
    await vi.advanceTimersByTimeAsync(2000)
    rooms = []
    await vi.advanceTimersByTimeAsync(3000)
    expect(w.state().rooms).toEqual([])
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(w.pendingActions().has('r')).toBe(false)
    expect(w.state().rooms).toEqual([])
  })

  it('fires onChange when only the pending actions change', async () => {
    rooms = [mkRoom('r', 10, 0)]
    statuses = { r: busy(5) }
    const w = start()
    await vi.advanceTimersByTimeAsync(0)
    const fn = vi.fn()
    w.onChange(fn)
    const approval = { kind: 'approval' as const, member_id: 'a', task_id: 't', execution_generation: 1, session_id: 's', request_id: 'q', approval: {} }
    statuses = { r: { ...busy(5), pending_actions: [approval] } }
    await w.refreshRoom('r')
    expect(fn).toHaveBeenCalledTimes(1)
    statuses = { r: busy(5) }
    await w.refreshRoom('r')
    expect(fn).toHaveBeenCalledTimes(2)
    statuses = { r: busy(9) }
    await w.refreshRoom('r')
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
