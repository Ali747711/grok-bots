import type { ServerRequest } from '../vendor/hermes/json-rpc-channel.js'
import { type PendingKind, PendingStore } from './pending-store.js'
import { applyGatewayEvent, routeServerRequest, summarize, type WatcherEvent } from './request-router.js'

/** The slice of the vendored JsonRpcGatewayClient the watcher uses (fakeable in tests). */
export interface WatcherClient {
  close(): void
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>
  onRequest(handler: (request: ServerRequest) => boolean | void): () => void
  onEvent(handler: (event: WatcherEvent) => void): () => void
  onState(handler: (state: string) => void): () => void
}

export interface WatcherDeps {
  readonly client: WatcherClient
  readonly connect: (client: WatcherClient) => Promise<void>
  readonly now: () => number
  readonly reconnectDelayMs: (attempt: number) => number
}

export interface DebugEntry {
  readonly at: number
  readonly kind: 'server_request' | 'event' | 'subscribed' | 'error'
  readonly detail: string
}

export interface Watcher {
  readonly store: PendingStore
  debug(): readonly DebugEntry[]
  stop(): void
}

interface ProfileRow { name: string; canonical_session?: { id?: string } | null }
interface PendingPrompt { kind: PendingKind; prompt_id: string; execution_generation: number; choices?: string[] }
interface Snapshot {
  session_id: string
  stored_session_id?: string
  prompts?: (PendingPrompt & Record<string, unknown>)[]
  open_requests?: { id: string; method: string; params: Record<string, unknown> }[] | null
}

const DEBUG_MAX = 200
const noop = () => undefined

/**
 * Headless observer: one upstream connection, subscribed to every bot's canonical "Bot Chat", holding
 * approval/question/secret requests for the Needs-you inbox. It never answers on the user's behalf.
 */
export function startWatcher(deps: WatcherDeps): Watcher {
  const { client } = deps
  const store = new PendingStore()
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
  const ctx = { profileForSession: (sid: string) => sessionProfile.get(sid), now: deps.now }

  function recordSnapshot(profile: string, snap: Snapshot): void {
    sessionProfile.set(snap.session_id, profile)
    if (snap.stored_session_id) sessionProfile.set(snap.stored_session_id, profile)
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

  async function syncOnce(): Promise<void> {
    const { profiles } = await client.request<{ profiles: ProfileRow[] }>('profiles.list', { include_sessions: true })
    for (const row of profiles) {
      const storedId = row.canonical_session?.id
      if (!storedId || subscribed.has(storedId)) continue
      try {
        const snap = await client.request<Snapshot>('session.resume', { profile: row.name, session_id: storedId, omit_messages: true })
        subscribed = new Set([...subscribed, storedId])
        recordSnapshot(row.name, snap)
        note('subscribed', `${row.name} ${storedId} → ${snap.session_id}`)
      } catch (error) {
        note('error', `resume ${row.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  /** Serialized: a sessions.changed during a sync triggers exactly one more pass afterwards. */
  function sync(): Promise<void> {
    if (syncing) {
      resyncWanted = true
      return syncing
    }
    syncing = syncOnce()
      .catch(error => note('error', `sync: ${error instanceof Error ? error.message : String(error)}`))
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
    try {
      subscribed = new Set()
      await deps.connect(client)
      attempt = 0
      await sync()
    } catch (error) {
      note('error', `connect: ${error instanceof Error ? error.message : String(error)}`)
      scheduleReconnect()
    }
  }

  const unsubscribers = [
    client.onRequest(req => {
      note('server_request', `${req.method} keys=${Object.keys(req.params ?? {}).join(',')}`)
      return routeServerRequest(req, store, ctx)
    }),
    client.onEvent(event => {
      note('event', `${event.type}${event.session_id ? ` ${event.session_id}` : ''}`)
      applyGatewayEvent(event, store, ctx)
      if (event.type === 'sessions.changed') void sync()
    }),
    client.onState(state => {
      if (state === 'closed' || state === 'error') scheduleReconnect()
    })
  ]
  void connectNow()

  return {
    store,
    debug: () => log,
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
      for (const unsubscribe of unsubscribers) unsubscribe()
      client.close()
    }
  }
}
