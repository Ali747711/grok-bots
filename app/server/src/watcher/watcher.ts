import type { SandboxState } from '../bots/sandbox-state.js'
import { HermesRpcError, HermesUnavailableError, type Rpc } from '../hermes/errors.js'
import { log as logger } from '../log.js'
import type { SettingsStore } from '../settings/settings-store.js'
import { JsonRpcGatewayError, type ServerRequest } from '../vendor/hermes/json-rpc-channel.js'
import { type AnswerInput, answerRequest } from './answer.js'
import { BotStateTracker, type CrewState, type ProfileInput, type WatcherState } from './bot-state.js'
import { type PendingKind, type PendingRequest, PendingStore } from './pending-store.js'
import { applyGatewayEvent, approvalDetail, routeServerRequest, summarize, type WatcherEvent } from './request-router.js'

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
  readonly settings: Pick<SettingsStore, 'get' | 'onChange'>
  readonly now: () => number
  readonly reconnectDelayMs: (attempt: number) => number
  /** Observe WebSocket close codes (4401 = Hermes says our token is no longer valid). */
  /** Sandbox state per bot name for the roster; must not reject (the roster cache never does). */
  readonly sandboxStates?: (names: readonly string[]) => Promise<ReadonlyMap<string, SandboxState>>
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
  state(): WatcherState
  /** Fires (debounced 100 ms) when anything in `state()` may have changed. */
  onChange(listener: () => void): () => void
  /** Send the user's answer to Hermes without waiting for it; progress shows in `state()`. */
  answer(id: string, input: AnswerInput): 'sent' | 'not_found' | 'already_resolved' | 'answering' | 'offline' | 'unsupported'
  /** The bot's avatar as a `data:` URL via `profiles.get_asset`; `found: false` when it has none. */
  getAvatar(name: string): Promise<{ found: boolean; mime?: string; data?: string }>
  /** JSON-RPC to Hermes over the watcher's connection. Rejects HermesUnavailableError when not connected. */
  request: Rpc
  /** Re-read the roster now. Resolves only after a sync that started after the call (a running one gets one shared trailing sync). */
  refresh(): Promise<void>
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

const REQUEST_TIMEOUT_MS = 60_000
const DEBUG_MAX = 200
const DEBOUNCE_MS = 100
const SYNC_RETRY_BASE_MS = 1000
const SYNC_RETRY_MAX_MS = 30_000
const REFRESH_MS = 10_000
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
  /** Ids this process handed an answer to Hermes for (audit: did the allow come through Crew?). */
  const sentByCrew = new Set<string>()
  let hermes: CrewState['hermes'] = 'connecting'
  let authClosed = false
  /** Bumped on every close; a connect/sync that started before a close must not report `connected`. */
  let connectionEpoch = 0
  let changeTimer: NodeJS.Timeout | null = null
  let syncRetryTimer: NodeJS.Timeout | null = null
  let syncFailures = 0
  const sessionProfile = new Map<string, string>()
  let log: readonly DebugEntry[] = []
  /** profile → the session tip it is currently subscribed to (a changed tip needs a fresh resume). */
  let subscribed = new Map<string, string>()
  let attempt = 0
  let timer: NodeJS.Timeout | null = null
  let stopped = false
  let syncing: Promise<void> | null = null
  let trailing: Promise<void> | null = null

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

  /** Learn that `sid` belongs to `profile`; entries first seen before this get their owner back. */
  function mapSession(profile: string, sid: string | undefined): void {
    if (!sid) return
    sessionProfile.set(sid, profile)
    tracker.markSubscribed(profile, sid)
    store.repairProfile(sid, profile)
  }

  function recordSnapshot(profile: string, snap: Snapshot): void {
    mapSession(profile, snap.session_id)
    mapSession(profile, snap.stored_session_id)
    tracker.applyEvent({
      type: 'session.info', session_id: snap.session_id, execution_generation: snap.execution_generation,
      payload: { running: snap.running }
    })
    for (const p of snap.prompts ?? []) {
      store.add({
        id: p.prompt_id, kind: p.kind, profile, sessionId: snap.session_id, summary: summarize(p.kind, p), ...approvalDetail(p.kind, p),
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
    // Not awaited: a stalled config read must not delay the roster, status or approval updates.
    if (deps.sandboxStates) {
      void deps.sandboxStates(profiles.map(row => row.name)).then(states => {
        if (tracker.applySandbox(states)) changed()
      }).catch(() => undefined)
    }
    let ok = true
    for (const row of profiles) {
      const chat = row.canonical_session
      // The tip (resolved_id) moves when a chat is compressed; the root id stays. Follow the tip.
      const storedId = chat?.resolved_id ?? chat?.id
      if (!chat || !storedId) continue
      mapSession(row.name, chat.id)
      mapSession(row.name, chat.resolved_id)
      if (subscribed.get(row.name) === storedId) continue
      try {
        const requestedAt = deps.now()
        const snap = await client.request<Snapshot>('session.resume', { profile: row.name, session_id: storedId, omit_messages: true })
        subscribed = new Map([...subscribed, [row.name, storedId]])
        recordSnapshot(row.name, snap)
        const sessionIds = [snap.session_id, snap.stored_session_id].filter((id): id is string => Boolean(id))
        store.reconcile(sessionIds, new Set((snap.prompts ?? []).map(p => p.prompt_id)), requestedAt)
        store.reconcileRequests(sessionIds, new Set((snap.open_requests ?? []).map(r => r.id)), requestedAt)
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

  /**
   * Serialized, and the returned promise always resolves after a sync that STARTED after this call:
   * while one runs, every caller shares exactly one trailing sync that begins when it finishes.
   */
  function sync(): Promise<void> {
    if (syncing) {
      trailing ??= syncing.then(() => {
        trailing = null
        return stopped ? undefined : sync()
      })
      return trailing
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
    const epoch = connectionEpoch
    try {
      subscribed = new Map()
      await deps.connect(client)
      attempt = 0
      authClosed = false
      await sync()
      if (epoch === connectionEpoch) setHermes('connected')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      note('error', `connect: ${message}`)
      setHermes(AUTH_ERROR.test(message) ? 'signed_out' : 'offline')
      scheduleReconnect()
    }
  }

  /** What Crew can actually send: prompts need ids, server requests need the live request, batch clarify never. */
  function isAnswerable(e: PendingRequest): boolean {
    if (e.source === 'event' || e.source === 'snapshot_prompt') return Boolean(e.promptId) && typeof e.executionGeneration === 'number' && e.profile !== 'unknown'
    return e.kind !== 'clarify' && held.has(e.id)
  }

  async function deliverAnswer(entry: PendingRequest, input: AnswerInput): Promise<void> {
    const serverRequest = held.get(entry.id)
    const choice = 'choice' in input ? { choice: input.choice.slice(0, 200) } : {}
    try {
      const onSent = (method: string) => {
        sentByCrew.add(entry.id)
        // Never the answer text or secret value: only the approval choice.
        logger.info('answer sent', { id: entry.id, kind: entry.kind, profile: entry.profile, method, ...choice })
      }
      const outcome = await answerRequest(entry, input, { client, onSent, ...(serverRequest ? { serverRequest } : {}) })
      logger.info('answer outcome', { id: entry.id, kind: entry.kind, ok: true, status: outcome })
      if (outcome === 'already_resolved') store.settle(entry.id, 'settled')
      // A response to an srq- request is final and Hermes never acknowledges it to us, so settle now.
      else if (serverRequest) store.settle(entry.id, 'answered')
    } catch (error) {
      // Never include the input: it may be a secret. Hermes' own reason (e.g. stale_generation) is safe.
      const reason = serverRequest ? 'send_failed' : error instanceof Error ? error.message.slice(0, 200) : 'send_failed'
      logger.warn('answer failed', { id: entry.id, kind: entry.kind, reason })
      logger.info('answer outcome', { id: entry.id, kind: entry.kind, ok: false, reason })
      store.markAnswer(entry.id, 'failed', reason)
    }
  }

  const unsubscribers = [
    client.onRequest(req => {
      note('server_request', `${req.method} keys=${Object.keys(req.params ?? {}).join(',')}`)
      const handled = routeServerRequest(req, store, ctx)
      // A replay after reconnect reuses the id: keep the fresh object so an entry that failed offline works again.
      if (store.get(req.id) && !store.get(req.id)?.settled) held.set(req.id, req)
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
        connectionEpoch += 1
        // Handles are bound to the dead connection: answering through one would report success for nothing.
        held.clear()
        setHermes(authClosed ? 'signed_out' : 'offline')
        scheduleReconnect()
      }
    }),
    store.onSettle(entry => {
      logger.info('request settled', {
        id: entry.id, kind: entry.kind, profile: entry.profile, reason: entry.settled, answeredByCrew: sentByCrew.has(entry.id)
      })
    }),
    deps.settings.onChange(changed),
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
        settings: deps.settings.get(),
        pending: open.map(({ settled: _s, settledAt: _t, answerState, answerError, ...rest }) => ({
          ...rest,
          state: answerState ?? ('open' as const),
          answerable: isAnswerable(rest as PendingRequest),
          ...(answerState === 'failed' && answerError ? { error: answerError } : {})
        }))
      }
    },
    answer: (id, input) => {
      const entry = store.get(id)
      if (!entry) return 'not_found'
      if (entry.settled) return 'already_resolved'
      if (entry.answerState === 'answering') return 'answering'
      if (hermes !== 'connected') {
        // respond() on a disconnected channel silently drops the answer, so never call it offline.
        store.markAnswer(id, 'failed', 'not_connected')
        return 'offline'
      }
      if (!isAnswerable(entry)) return 'unsupported'
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
    getAvatar: async name => {
      const r = await client.request<{ found: boolean; mime?: string | null; data?: string | null }>('profiles.get_asset', { name, asset: 'avatar' })
      return { found: r.found, ...(r.mime ? { mime: r.mime } : {}), ...(r.data ? { data: r.data } : {}) }
    },
    request: async <T>(method: string, params: Record<string, unknown>, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> => {
      if (hermes !== 'connected') throw new HermesUnavailableError()
      try {
        return await client.request<T>(method, params, timeoutMs)
      } catch (error) {
        if (error instanceof JsonRpcGatewayError) throw new HermesRpcError(error.code ?? -1, error.message, error.data)
        throw error
      }
    },
    refresh: sync,
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
