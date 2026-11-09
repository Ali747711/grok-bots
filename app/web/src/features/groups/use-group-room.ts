import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { GroupTurnAction, GroupView } from '@/state/types'

import { continueGroup, discardTurn, fetchGroupEvents, retryTurn, sendGroupMessage, stopGroup } from './groups-api'
import type { GroupEventsPage } from './groups-api'
import { appendEvents, currentTopic, hashEventId, toItems } from './room-reducer'
import type { GroupItem, OptimisticSend, RoomLog } from './room-reducer'

const HISTORY_WINDOW = 300
const EMPTY: RoomLog = { epoch: -1, cursor: 0, events: [], cut: false }

export interface GroupRoom {
  items: readonly GroupItem[]
  loading: boolean
  error: string | null
  cut: boolean
  /** Current thread id; null before any message. */
  topic: string | null
  send(text: string, opts: { newTopic: boolean }): Promise<void>
  retrySend(eventId: string): Promise<void>
  stop(): Promise<void>
  keepGoing(discussionEventId: string): Promise<void>
  /** Run the events fetch again (after an error). */
  retry(): Promise<void>
  retryTurn(action: GroupTurnAction): Promise<void>
  discardTurn(action: GroupTurnAction): Promise<void>
}

const REFUSAL_TEXT: Readonly<Record<string, string>> = { hermes_offline: 'Hermes is offline' }
const SEND_FAILED = 'Something went wrong. Try again.'
const messageOf = (e: unknown): string => (e instanceof Error && e.message ? e.message : SEND_FAILED)

/** Fetch pages from `since` until Hermes has no more, merging into `start`. */
async function readFrom(roomId: string, since: number, start: RoomLog, apply: (log: RoomLog) => void): Promise<void> {
  let log = start
  let from = since
  for (;;) {
    const page: GroupEventsPage = await fetchGroupEvents(roomId, from)
    log = appendEvents(log, page)
    apply(log)
    if (!page.hasMore || page.cursor <= from) return
    from = page.cursor
  }
}

/** Room history and actions. One events fetch runs at a time; moves during a fetch are picked up after it. */
export function useGroupRoom(view: GroupView | undefined, titleOf: (memberId: string) => string, online = true): GroupRoom {
  const [log, setLog] = useState<RoomLog>(EMPTY)
  const [optimistic, setOptimistic] = useState<readonly OptimisticSend[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef(log)
  const viewRef = useRef(view)
  const busy = useRef(false)
  const again = useRef(false)
  const loaded = useRef(false)
  const errorRef = useRef<string | null>(null)
  const cancelId = useRef<string | null>(null)
  viewRef.current = view
  errorRef.current = error

  const apply = useCallback((next: RoomLog) => {
    logRef.current = next
    setLog(next)
  }, [])

  const pass = useCallback(async () => {
    const v = viewRef.current
    if (!v) return
    const cur = logRef.current
    if (!loaded.current || v.epoch !== cur.epoch || v.latestSeq < cur.cursor) {
      const since = Math.max(0, v.latestSeq - HISTORY_WINDOW)
      // A new epoch replaces the log and clears `cut`, so the flag is set again on every page.
      await readFrom(v.id, since, EMPTY, next => apply({ ...next, cut: since > 0 }))
      loaded.current = true
    } else if (v.latestSeq > cur.cursor) {
      await readFrom(v.id, cur.cursor, cur, apply)
    }
  }, [apply])

  const sync = useCallback(async () => {
    if (busy.current) {
      again.current = true
      return
    }
    busy.current = true
    try {
      do {
        again.current = false
        await pass()
        setError(null)
      } while (again.current)
    } catch (e) {
      setError(messageOf(e))
    } finally {
      busy.current = false
      setLoading(false)
    }
  }, [pass])

  const id = view?.id
  const latestSeq = view?.latestSeq
  const epoch = view?.epoch
  useEffect(() => {
    if (id) void sync()
  }, [id, latestSeq, epoch, sync])

  // Coming back online with an unresolved error re-runs the fetch; the sync effect above only follows the view.
  useEffect(() => {
    if (online && errorRef.current && id) void sync()
  }, [online]) // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (eventId: string, change: Partial<OptimisticSend>) =>
    setOptimistic(prev => prev.map(o => (o.eventId === eventId ? { ...o, ...change } : o)))

  const deliver = async (roomId: string, o: OptimisticSend, text: string) => {
    const body = { eventId: o.eventId, text, ...(o.threadId === o.eventId ? {} : { threadId: o.threadId }) }
    let result = await sendGroupMessage(roomId, body)
    // Unknown means it may have been stored: the same eventId makes a second try safe.
    if (result.kind === 'unknown') result = await sendGroupMessage(roomId, body)
    if (result.kind === 'accepted') patch(o.eventId, { status: 'sending' })
    else if (result.kind === 'unknown') patch(o.eventId, { status: 'unknown' })
    else patch(o.eventId, { status: 'refused', error: `Not sent: ${REFUSAL_TEXT[result.reason] ?? result.reason}` })
  }

  // Only a send that has not reached the log yet can pin the topic; once it landed, the log (latest user message) decides.
  const landed = new Set(log.events.filter(e => e.kind === 'message.user').map(e => e.eventId))
  const topic = optimistic.findLast(o => o.status !== 'refused' && !landed.has(o.eventIdHash))?.threadId ?? currentTopic(log)

  const start = async (text: string, threadId: string | undefined) => {
    const roomId = viewRef.current?.id
    if (!roomId) return
    const eventId = crypto.randomUUID()
    const o: OptimisticSend = { eventId, eventIdHash: await hashEventId(eventId), text, threadId: threadId ?? eventId, status: 'sending' }
    setOptimistic(prev => [...prev, o])
    await deliver(roomId, o, text)
  }

  const send = (text: string, opts: { newTopic: boolean }) => start(text, opts.newTopic ? undefined : (topic ?? undefined))

  const retrySend = async (eventId: string) => {
    const roomId = viewRef.current?.id
    const o = optimistic.find(x => x.eventId === eventId)
    if (!roomId || !o) return
    if (o.status === 'refused') {
      // A refusal stored nothing, so the retry is a brand-new message in the same thread.
      setOptimistic(prev => prev.filter(x => x.eventId !== eventId))
      await start(o.text, o.threadId === o.eventId ? undefined : o.threadId)
      return
    }
    patch(eventId, { status: 'sending' })
    await deliver(roomId, o, o.text)
  }

  const act = async (run: () => Promise<unknown>) => {
    try {
      await run()
      setError(null)
    } catch (e) {
      setError(messageOf(e))
    }
  }

  const stop = () => act(async () => {
    const roomId = viewRef.current?.id
    if (!roomId) return
    // The same id is reused until a stop succeeds, so a retry cannot cancel twice.
    cancelId.current ??= crypto.randomUUID()
    await stopGroup(roomId, cancelId.current)
    cancelId.current = null
  })
  const keepGoing = (discussionEventId: string) => act(async () => { if (id) await continueGroup(id, discussionEventId) })
  // The server body is strict: send only the three identifying fields, not `kind`.
  const turn = (call: typeof retryTurn) => (a: GroupTurnAction) =>
    act(async () => { if (id) await call(id, { memberId: a.memberId, taskId: a.taskId, executionGeneration: a.executionGeneration }) })

  const items = useMemo(
    () => (view ? toItems(log, view, titleOf, optimistic) : []),
    [log, view, titleOf, optimistic]
  )
  return { items, loading, error, cut: log.cut, topic, send, retrySend, stop, keepGoing, retry: sync, retryTurn: turn(retryTurn), discardTurn: turn(discardTurn) }
}

