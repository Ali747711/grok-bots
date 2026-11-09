import { log as logger } from '../log.js'

import { isActive, previewFrom, toGroupView } from './group-view.js'
import type { GroupRpc } from './group-rpc.js'
import type { GroupPreview, GroupsState, HermesPendingAction, HermesRoom, HermesRoomState } from './types.js'

const LIST_MS = 5000
const ACTIVE_MS = 2000
const TAIL = 20
/** After a send (or any seq move) a room stays in the 2 s set this long: Auto routes before any member runs. */
const CLOSE_WINDOW_MS = 20_000

export interface GroupWatcher {
  state(): GroupsState
  /** Last successful pending actions per live room, for the pending bridge. */
  pendingActions(): ReadonlyMap<string, readonly HermesPendingAction[]>
  seatable(): ReadonlySet<string>
  onChange(listener: () => void): () => void
  /** Poll one room (state + tail) now. An unknown room refreshes the list. */
  refreshRoom(roomId: string): Promise<void>
  refreshList(): Promise<void>
  stop(): void
}

export interface GroupWatcherDeps {
  rpc: GroupRpc
  connected: () => boolean
  onConnectionChange: (listener: (connected: boolean) => void) => () => void
  now: () => number
  setInterval?: typeof setInterval
  clearInterval?: typeof clearInterval
}

interface Entry {
  room: HermesRoom
  state?: HermesRoomState
  preview: GroupPreview | null
  tailSeq: number
}

const seqOf = (e: Entry): number => e.state?.room.latest_seq ?? e.room.latest_seq ?? 0

export function startGroupWatcher(deps: GroupWatcherDeps): GroupWatcher {
  const { rpc } = deps
  const setIv = deps.setInterval ?? setInterval
  const clearIv = deps.clearInterval ?? clearInterval
  const entries = new Map<string, Entry>()
  const actions = new Map<string, readonly HermesPendingAction[]>()
  // Keyed by room id, not entry, so a dropped and re-listed room still never has two calls in flight.
  const chains = new Map<string, Promise<void>>()
  const listeners = new Set<() => void>()
  let available = false
  let seatable: string[] = []
  let capsLoaded = false
  // Room id -> time until which it is polled every 2 s even if Hermes reports it idle.
  const closeUntil = new Map<string, number>()
  let listing = false
  let capsFailing = false
  let stopped = false
  let published = ''

  const snapshot = (): GroupsState => ({
    available,
    seatable,
    rooms: [...entries.values()]
      .map(e => toGroupView(e.room, e.state, e.preview, deps.now()))
      .sort((a, b) => b.updatedAt - a.updatedAt)
  })

  const emitIfChanged = (): void => {
    // Pending actions are not part of GroupsState, but the approval bridge needs to hear about them.
    const next = JSON.stringify({ state: snapshot(), actions: [...actions] })
    if (next === published) return
    published = next
    for (const l of listeners) l()
  }

  const warn = (what: string, error: unknown): void => {
    logger.warn(`group watcher: ${what} failed`, { err: error instanceof Error ? error.message : String(error) })
  }

  // Calls for one room run one after another; a failure never breaks the chain. A job abandons its
  // work (via `live`) as soon as the room was dropped, so a late reply cannot revive it.
  const enqueue = (id: string, job: (e: Entry, live: () => boolean) => Promise<void>): Promise<void> => {
    const entry = entries.get(id)
    if (!entry) return Promise.resolve()
    const live = (): boolean => entries.get(id) === entry
    const run = (chains.get(id) ?? Promise.resolve()).then(async () => {
      if (!live()) return
      try {
        await job(entry, live)
      } catch (error) {
        warn(`room ${id}`, error)
      }
    })
    chains.set(id, run)
    void run.then(() => {
      if (chains.get(id) === run) chains.delete(id)
    })
    return run
  }

  const keepClose = (id: string): void => {
    closeUntil.set(id, deps.now() + CLOSE_WINDOW_MS)
  }
  const isClose = (id: string): boolean => (closeUntil.get(id) ?? 0) > deps.now()

  const pollRoom = (id: string): Promise<void> =>
    enqueue(id, async (entry, live) => {
      const state = await rpc.state(id)
      if (!live()) return
      entry.state = state
      actions.set(id, state.driver_status?.pending_actions ?? [])
      const seq = seqOf(entry)
      if (seq > entry.tailSeq) {
        const log = await rpc.log(id, Math.max(0, seq - TAIL), TAIL)
        if (!live()) return
        entry.preview = previewFrom(log.events)
        entry.tailSeq = seq
      }
    }).then(emitIfChanged)

  const refreshList = async (): Promise<void> => {
    listing = true
    try {
      await listOnce()
    } finally {
      listing = false
    }
  }

  const listOnce = async (): Promise<void> => {
    let rooms: HermesRoom[]
    try {
      rooms = await rpc.list()
    } catch (error) {
      warn('list', error)
      return
    }
    const seen = new Set<string>()
    const polls: Promise<void>[] = []
    for (const room of rooms) {
      seen.add(room.room_id)
      const prev = entries.get(room.room_id)
      if (!prev) entries.set(room.room_id, { room, preview: null, tailSeq: 0 })
      else {
        const changed = prev.room.updated_at !== room.updated_at || (prev.room.latest_seq ?? 0) !== (room.latest_seq ?? 0)
        prev.room = room
        if (!changed) continue
        keepClose(room.room_id)
      }
      polls.push(pollRoom(room.room_id))
    }
    for (const id of [...entries.keys()]) {
      if (seen.has(id)) continue
      entries.delete(id)
      actions.delete(id)
      closeUntil.delete(id)
    }
    emitIfChanged()
    await Promise.all(polls)
  }

  const loadCapabilities = async (): Promise<void> => {
    try {
      const caps = await rpc.capabilities()
      available = caps.driver === true
      seatable = [...caps.seatable_profiles].sort()
      capsLoaded = true
      capsFailing = false
    } catch (error) {
      // One warning per failure streak, not one per 5 s tick.
      if (!capsFailing) warn('capabilities', error)
      capsFailing = true
    }
  }

  const connect = async (): Promise<void> => {
    await loadCapabilities()
    if (available) await refreshList()
    else emitIfChanged()
  }

  const listTimer = setIv(() => {
    if (stopped || !deps.connected() || listing) return
    if (!capsLoaded) void connect()
    // Capabilities are re-read every tick: a bot created after Crew connected becomes seatable without a restart.
    else void loadCapabilities().then(() => (available ? refreshList() : emitIfChanged()))
  }, LIST_MS)
  const activeTimer = setIv(() => {
    if (stopped || !deps.connected()) return
    // A room whose poll is still queued or running is skipped, so a slow Hermes cannot build a backlog.
    for (const [id, e] of entries) if ((isActive(e.state) || isClose(id)) && !chains.has(id)) void pollRoom(id)
    emitIfChanged()
  }, ACTIVE_MS)
  const unsubscribe = deps.onConnectionChange(up => {
    if (up && !stopped) void connect()
  })
  if (deps.connected()) void connect()

  return {
    state: snapshot,
    pendingActions: () => actions,
    seatable: () => new Set(seatable),
    onChange(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    refreshRoom(id) {
      if (!entries.has(id)) return refreshList()
      keepClose(id)
      return pollRoom(id)
    },
    refreshList,
    stop() {
      stopped = true
      clearIv(listTimer)
      clearIv(activeTimer)
      unsubscribe()
      listeners.clear()
    }
  }
}
