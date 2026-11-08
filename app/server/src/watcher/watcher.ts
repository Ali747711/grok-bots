import { log as logger } from '../log.js'
import type { ServerRequest } from '../vendor/hermes/json-rpc-channel.js'
import { type AnswerInput, answerRequest } from './answer.js'
import { BotStateTracker, type CrewState, type ProfileInput } from './bot-state.js'
import { type PendingKind, type PendingRequest, PendingStore } from './pending-store.js'
import { applyGatewayEvent, routeServerRequest, summarize, type WatcherEvent } from './request-router.js'

/** The slice of the vendored JsonRpcGatewayClient the watcher uses (fakeable in tests). */
export interface WatcherClient {
  close(): void
  request<T>(method: string, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>
  onRequest(handler: (request: ServerRequest) => boolean | void): () => void
  onEvent(handler: (event: WatcherEvent) => void): () => void
  onState(handler: (state: string) => void): () => void
}

export interface WatcherDeps {
  readonly client: WatcherClient
  readonly connect: (client: WatcherClient) => Promise<void>
  readonly now: () => number
  readonly reconnectDelayMs: (attempt: number) => number
  /** Observe WebSocket close codes (4401 = Hermes says our token is no longer valid). */
  readonly onSocketClose?: (handler: (code: number) => void) => () => void
}

export interface DebugEntry {
  readonly at: number
  readonly kind: 'server_request' | 'event' | 'subscribed' | 'error'
  readonly detail: string
}

export interface Watcher {
  readonly store: PendingStore
  /** Current roster, bot status, Hermes connection and open requests. */
  state(): CrewState
  /** Fires (debounced 100 ms) when anything in `state()` may have changed. */
  onChange(listener: () => void): () => void
  /** Send the user's answer to Hermes without waiting for it; progress shows in `state()`. */
  answer(id: string, input: AnswerInput): 'sent' | 'not_found' | 'already_resolved' | 'answering'
  debug(): readonly DebugEntry[]
  stop(): void
}

type ProfileRow = ProfileInput
interface PendingPrompt { kind: PendingKind; prompt_id: string; execution_generation: number; choices?: string[] }
interface Snapshot {
  session_id: string
  stored_session_id?: string
  execution_generation?: number
  running?: boolean
  prompts?: (PendingPrompt & Record<string, unknown>)[]
  open_requests?: { id: string; method: string; params: Record<string, unknown> }[] | null
}

const DEBUG_MAX = 200
const DEBOUNCE_MS = 100
const SYNC_RETRY_BASE_MS = 1000
const SYNC_RETRY_MAX_MS = 30_000
const REFRESH_MS = 30_000
const SETTLED_TTL_MS = 10 * 60_000
const AUTH_CLOSE_CODES = new Set([4401, 4403])
const AUTH_ERROR = /\b(4401|4403|401|403)\b/
const noop = () => undefined

/**
 * Headless observer: one upstream connection, subscribed to every bot's canonical "Bot Chat", holding
 * approval/question/secret requests for the Needs-you inbox. It never answers on the user's behalf.
 */
export function startWatcher(deps: WatcherDeps): Watcher {
  const { client } = deps
  const store = new PendingStore(deps.now)
  const tracker = new BotStateTracker()
  const listeners = new Set<() => void>()
  /** Live legacy `srq-…` requests, kept only so the user's answer can be routed back to them. */
  const held = new Map<string, ServerRequest>()
  let hermes: CrewState['hermes'] = 'connecting'
  let authClosed = false
  let changeTimer: NodeJS.Timeout | null = null
  let syncRetryTimer: NodeJS.Timeout | null = null
  let syncFailures = 0
  const sessionProfile = new Map<string, string>()
  let log: readonly DebugEntry[] = []
  let subscribed = new Set<string>()
  let attempt = 0
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  let syncing: Promise<void> | null = null
  let resyncWanted = false

  const note = (kind: DebugEntry['kind'], detail: string) => {
    log = [...log.slice(-(DEBUG_MAX - 1)), { at: deps.now(), kind, detail }]
  }

  function changed(): void {
    if (changeTimer || stopped) return
    changeTimer = setTimeout(() => {
      changeTimer = null
      for (const listener of [...listeners]) listener()
    }, DEBOUNCE_MS)
  }
  const setHermes = (next: CrewState['hermes']) => {
    if (hermes === next) return
    hermes = next
    changed()
  }
  const ctx = { profileForSession: (sid: string) => sessionProfile.get(sid), now: deps.now }

  function recordSnapshot(profile: string, snap: Snapshot): void {
    for (const sid of [snap.session_id, snap.stored_session_id]) {
      if (!sid) continue
      sessionProfile.set(sid, profile)
      tracker.markSubscribed(profile, sid)
    }
    tracker.applyEvent({
      type: 'session.info', session_id: snap.session_id, execution_generation: snap.execution_generation,
      payload: { running: snap.running }
    })
    for (const p of snap.prompts ?? []) {
      store.add({
        id: p.prompt_id, kind: p.kind, profile, sessionId: snap.session_id, summary: summarize(p.kind, p),
        ...(p.choices ? { choices: p.choices } : {}), receivedAt: deps.now(), source: 'snapshot_prompt',
        promptId: p.prompt_id, executionGeneration: p.execution_generation
      })
    }
    for (const r of snap.open_requests ?? []) {
      const synthetic = { ...r, replayed: true, respond: noop, fail: noop, decline: noop } as ServerRequest
      routeServerRequest(synthetic, store, ctx, 'open_request')
    }
  }

  /** Returns false when profiles.list or any resume failed, so the caller retries with backoff. */
  async function syncOnce(): Promise<boolean> {
    const { profiles } = await client.request<{ profiles: ProfileRow[] }>('profiles.list', { include_sessions: true })
    tracker.applyProfiles(profiles)
    changed()
    let ok = true
    for (const row of profiles) {
      const storedId = row.canonical_session?.id
      if (!storedId || subscribed.has(storedId)) continue
      try {
        const requestedAt = deps.now()
        const snap = await client.request<Snapshot>('session.resume', { profile: row.name, session_id: storedId, omit_messages: true })
        subscribed = new Set([...subscribed, storedId])
        recordSnapshot(row.name, snap)
        const sessionIds = [snap.session_id, snap.stored_session_id].filter((id): id is string => Boolean(id))
        store.reconcile(sessionIds, new Set((snap.prompts ?? []).map(p => p.prompt_id)), requestedAt)
        note('subscribed', `${row.name} ${storedId} → ${snap.session_id}`)
        changed()
      } catch (error) {
        ok = false
        note('error', `resume ${row.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return ok
  }

  function scheduleSyncRetry(): void {
    if (stopped || syncRetryTimer) return
    const delay = Math.min(SYNC_RETRY_MAX_MS, SYNC_RETRY_BASE_MS * 2 ** syncFailures)
    syncFailures += 1
    syncRetryTimer = setTimeout(() => {
      syncRetryTimer = null
      void sync()
    }, delay)
  }

  /** Serialized: a sessions.changed during a sync triggers exactly one more pass afterwards. */
  function sync(): Promise<void> {
    if (syncing) {
      resyncWanted = true
      return syncing
    }
    syncing = syncOnce()
      .then(ok => {
        if (ok) syncFailures = 0
        else scheduleSyncRetry()
      })
      .catch(error => {
        note('error', `sync: ${error instanceof Error ? error.message : String(error)}`)
        scheduleSyncRetry()
      })
      .finally(() => {
        syncing = null
        if (resyncWanted && !stopped) {
          resyncWanted = false
          void sync()
        }
      })
    return syncing
  }

  function scheduleReconnect(): void {
    if (stopped || timer) return
    timer = setTimeout(() => {
      timer = null
      void connectNow()
    }, deps.reconnectDelayMs(attempt))
  }

  async function connectNow(): Promise<void> {
    attempt += 1
    setHermes('connecting')
    try {
      subscribed = new Set()
      await deps.connect(client)
      attempt = 0
      authClosed = false
      await sync()
      setHermes('connected')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      note('error', `connect: ${message}`)
      setHermes(AUTH_ERROR.test(message) ? 'signed_out' : 'offline')
      scheduleReconnect()
    }
  }

  async function deliverAnswer(entry: PendingRequest, input: AnswerInput): Promise<void> {
    const serverRequest = held.get(entry.id)
    try {
      const outcome = await answerRequest(entry, input, { client, ...(serverRequest ? { serverRequest } : {}) })
      if (outcome === 'already_resolved') store.settle(entry.id, 'settled')
    } catch (error) {
      // Never include the input: it may be a secret. Hermes' own reason (e.g. stale_generation) is safe.
      const reason = serverRequest ? 'send_failed' : error instanceof Error ? error.message.slice(0, 200) : 'send_failed'
      logger.warn('answer failed', { id: entry.id, kind: entry.kind, reason })
      store.markAnswer(entry.id, 'failed', reason)
    }
  }

  const unsubscribers = [
    client.onRequest(req => {
      note('server_request', `${req.method} keys=${Object.keys(req.params ?? {}).join(',')}`)
      const handled = routeServerRequest(req, store, ctx)
      if (store.get(req.id)) held.set(req.id, req)
      return handled
    }),
    client.onEvent(event => {
      note('event', `${event.type}${event.session_id ? ` ${event.session_id}` : ''}`)
      applyGatewayEvent(event, store, ctx)
      tracker.applyEvent(event)
      changed()
      if (event.type === 'sessions.changed') void sync()
    }),
    client.onState(state => {
      if (state === 'closed' || state === 'error') {
        setHermes(authClosed ? 'signed_out' : 'offline')
        scheduleReconnect()
      }
    }),
    store.onChange(() => {
      for (const id of held.keys()) if (!store.list().some(p => p.id === id)) held.delete(id)
      changed()
    }),
    deps.onSocketClose?.(code => {
      authClosed = AUTH_CLOSE_CODES.has(code)
    }) ?? noop
  ]
  // Periodic refresh: roster changes (new bots, previews) without a sessions.changed, and pruning.
  const refresh = setInterval(() => {
    store.prune(SETTLED_TTL_MS)
    if (hermes === 'connected') void sync()
  }, REFRESH_MS)
  void connectNow()

  return {
    store,
    state: () => {
      const open = store.list()
      return {
        hermes,
        bots: tracker.view(open),
        pending: open.map(({ settled: _s, settledAt: _t, answerState, answerError, ...rest }) => ({
          ...rest,
          state: answerState ?? ('open' as const),
          ...(answerState === 'failed' && answerError ? { error: answerError } : {})
        }))
      }
    },
    answer: (id, input) => {
      const entry = store.get(id)
      if (!entry) return 'not_found'
      if (entry.settled) return 'already_resolved'
      if (entry.answerState === 'answering') return 'answering'
      store.markAnswer(id, 'answering')
      void deliverAnswer(entry, input)
      return 'sent'
    },
    onChange: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    debug: () => log,
    stop: () => {
      stopped = true
      clearInterval(refresh)
      for (const t of [timer, changeTimer, syncRetryTimer]) if (t) clearTimeout(t)
      for (const unsubscribe of unsubscribers) unsubscribe()
      client.close()
    }
  }
}
