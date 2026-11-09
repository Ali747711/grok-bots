import { log as logger } from '../log.js'

import { isActive, previewFrom, toGroupView } from './group-view.js'
import type { GroupRpc } from './group-rpc.js'
import type { GroupPreview, GroupsState, HermesPendingAction, HermesRoom, HermesRoomState } from './types.js'

const LIST_MS = 5000
const ACTIVE_MS = 2000
const TAIL = 20

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
  chain: Promise<void>
}

const seqOf = (e: Entry): number => e.state?.room.latest_seq ?? e.room.latest_seq ?? 0

export function startGroupWatcher(deps: GroupWatcherDeps): GroupWatcher {
  const { rpc } = deps
  const setIv = deps.setInterval ?? setInterval
  const clearIv = deps.clearInterval ?? clearInterval
  const entries = new Map<string, Entry>()
  const actions = new Map<string, readonly HermesPendingAction[]>()
  const listeners = new Set<() => void>()
  let available = false
  let seatable: string[] = []
  let capsLoaded = false
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
    const next = JSON.stringify(snapshot())
    if (next === published) return
    published = next
    for (const l of listeners) l()
  }

  const warn = (what: string, error: unknown): void => {
    logger.warn(`group watcher: ${what} failed`, { err: error instanceof Error ? error.message : String(error) })
  }

  // Calls for one room run one after another; a failure never breaks the chain.
  const enqueue = (id: string, job: (e: Entry) => Promise<void>): Promise<void> => {
    const entry = entries.get(id)
    if (!entry) return Promise.resolve()
    const run = entry.chain.then(async () => {
      if (entries.get(id) !== entry) return
      try {
        await job(entry)
      } catch (error) {
        warn(`room ${id}`, error)
      }
    })
    entry.chain = run
    return run
  }

  const pollRoom = (id: string): Promise<void> =>
    enqueue(id, async entry => {
      entry.state = await rpc.state(id)
      actions.set(id, entry.state.driver_status?.pending_actions ?? [])
      const seq = seqOf(entry)
      if (seq > entry.tailSeq) {
        const log = await rpc.log(id, Math.max(0, seq - TAIL), TAIL)
        entry.preview = previewFrom(log.events)
        entry.tailSeq = seq
      }
    }).then(emitIfChanged)

  const refreshList = async (): Promise<void> => {
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
      if (!prev) entries.set(room.room_id, { room, preview: null, tailSeq: 0, chain: Promise.resolve() })
      else {
        const changed = prev.room.updated_at !== room.updated_at || (prev.room.latest_seq ?? 0) !== (room.latest_seq ?? 0)
        prev.room = room
        if (!changed) continue
      }
      polls.push(pollRoom(room.room_id))
    }
    for (const id of [...entries.keys()]) {
      if (seen.has(id)) continue
      entries.delete(id)
      actions.delete(id)
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
    } catch (error) {
      warn('capabilities', error)
    }
  }

  const connect = async (): Promise<void> => {
    await loadCapabilities()
    if (available) await refreshList()
    else emitIfChanged()
  }

  const listTimer = setIv(() => {
    if (stopped || !deps.connected()) return
    if (!capsLoaded) void connect()
    else if (available) void refreshList()
  }, LIST_MS)
  const activeTimer = setIv(() => {
    if (stopped || !deps.connected()) return
    for (const [id, e] of entries) if (isActive(e.state)) void pollRoom(id)
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
    refreshRoom: id => (entries.has(id) ? pollRoom(id) : refreshList()),
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
