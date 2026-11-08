import type { ServerRequest } from '../vendor/hermes/json-rpc-channel.js'
import type { PendingKind, PendingSource, PendingStore } from './pending-store.js'

const HELD: ReadonlySet<string> = new Set<PendingKind>(['approval', 'clarify', 'sudo', 'secret'])
const SUMMARY_MAX = 300

export interface RouteContext {
  profileForSession(sessionId: string): string | undefined
  now(): number
}

export interface WatcherEvent {
  readonly type: string
  readonly session_id?: string
  readonly payload?: unknown
}

type Params = Readonly<Record<string, unknown>>

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value.trim() : undefined)

/** Human-readable summary. Only descriptive fields are read — a secret request's value never is. */
export function summarize(kind: PendingKind, params: Params): string {
  const parts =
    kind === 'approval'
      ? [text(params.description), text(params.command)]
      : kind === 'clarify'
        ? [text(params.question)]
        : [text(params.prompt), text(params.label), text(params.description), text(params.env_var)]
  return parts.filter(Boolean).join(' — ').slice(0, SUMMARY_MAX)
}

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(v => typeof v === 'string') ? value : undefined
}

/**
 * Hold approval/clarify/sudo/secret requests for the user (never answered here), and politely decline
 * everything else with "not shown" (4404) — never an error reply, which could cancel the request for
 * other clients (tui_gateway/server_requests.py:281-315). Always returns true so nothing falls through to -32601.
 */
export function routeServerRequest(
  req: ServerRequest,
  store: PendingStore,
  ctx: RouteContext,
  source: PendingSource = 'server_request'
): true {
  if (!HELD.has(req.method)) {
    req.decline('not shown in Crew')
    return true
  }
  const kind = req.method as PendingKind
  const params = req.params as Params
  const sessionId = text(params.session_id) ?? ''
  const choices = stringList(params.choices)
  store.add({
    id: req.id,
    kind,
    profile: ctx.profileForSession(sessionId) ?? 'unknown',
    sessionId,
    summary: summarize(kind, params),
    ...(choices ? { choices } : {}),
    receivedAt: ctx.now(),
    source
  })
  return true
}

/** Settle requests Hermes withdrew (answered elsewhere, interrupted, timed out). */
export function applyGatewayEvent(event: WatcherEvent, store: PendingStore): void {
  const payload = (event.payload ?? {}) as Params
  if (event.type === 'request.cancel' && typeof payload.id === 'string') {
    store.settle(payload.id, 'cancelled')
  }
  if (event.type === 'approval.cancelled') {
    for (const id of stringList(payload.request_ids) ?? []) store.settle(id, 'cancelled')
  }
}
