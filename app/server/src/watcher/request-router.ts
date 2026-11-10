import type { ServerRequest } from '../vendor/hermes/json-rpc-channel.js'
import { appPromptOf, type AppPrompt } from './app-prompt.js'
import type { PendingKind, PendingSource, PendingStore } from './pending-store.js'

const HELD: ReadonlySet<string> = new Set<PendingKind>(['approval', 'clarify', 'sudo', 'secret'])
const SUMMARY_MAX = 300
export const DETAIL_MAX = 16_384

export interface RouteContext {
  profileForSession(sessionId: string): string | undefined
  now(): number
}

export interface WatcherEvent {
  readonly type: string
  readonly session_id?: string
  readonly payload?: unknown
  /** Owner stamp, at the top level of the event params (not inside `payload`). */
  readonly execution_generation?: number
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

export interface ApprovalDetail {
  readonly command?: string
  readonly description?: string
  readonly detailTruncated?: true
  /** Set for a Crew app tool's trust prompt; the store then keeps only once/deny. */
  readonly app?: AppPrompt
}

/** Full command/description of an approval (each capped at DETAIL_MAX); empty for every other kind. */
export function approvalDetail(kind: PendingKind, params: Params): ApprovalDetail {
  if (kind !== 'approval') return {}
  const command = text(params.command)
  const description = text(params.description)
  const truncated = (command?.length ?? 0) > DETAIL_MAX || (description?.length ?? 0) > DETAIL_MAX
  const app = appPromptOf(params)
  return {
    ...(app ? { app } : {}),
    ...(command ? { command: command.slice(0, DETAIL_MAX) } : {}),
    ...(description ? { description: description.slice(0, DETAIL_MAX) } : {}),
    ...(truncated ? { detailTruncated: true as const } : {})
  }
}

function stringList(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every(v => typeof v === 'string') ? value : undefined
}

/**
 * Hold approval/clarify/sudo/secret requests for the user (never answered here). Everything else is
 * accepted and ignored: Hermes treats ANY error reply to a server request (even the 4404 decline) as
 * "skipped" for every client, so we must not reply at all. Always returns true so nothing falls
 * through to the channel's -32601 reply.
 */
export function routeServerRequest(
  req: ServerRequest,
  store: PendingStore,
  ctx: RouteContext,
  source: PendingSource = 'server_request'
): true {
  if (!HELD.has(req.method)) {
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
    ...approvalDetail(kind, params),
    ...(choices ? { choices } : {}),
    receivedAt: ctx.now(),
    source
  })
  return true
}

const PROMPT_REQUEST: Readonly<Record<string, PendingKind>> = { 'approval.request': 'approval', 'clarify.request': 'clarify' }
const PROMPT_SETTLED = new Set(['approval.settled', 'clarify.settled'])

/**
 * Canonical protocol (session_authority): subscribers learn about prompts through `approval.request` /
 * `clarify.request` events and their `*.settled` counterparts (docs/phase0/approval-experiment.md E1).
 * Also settles legacy withdrawals (`request.cancel`, `approval.cancelled`).
 */
export function applyGatewayEvent(event: WatcherEvent, store: PendingStore, ctx: RouteContext): void {
  const payload = (event.payload ?? {}) as Params
  const promptKind = PROMPT_REQUEST[event.type]
  if (promptKind && typeof payload.prompt_id === 'string') {
    const sessionId = event.session_id ?? ''
    const choices = stringList(payload.choices)
    const generation = payload.execution_generation ?? event.execution_generation
    store.add({
      id: payload.prompt_id,
      kind: promptKind,
      profile: ctx.profileForSession(sessionId) ?? 'unknown',
      sessionId,
      summary: summarize(promptKind, payload),
      ...approvalDetail(promptKind, payload),
      ...(choices ? { choices } : {}),
      receivedAt: ctx.now(),
      source: 'event',
      promptId: payload.prompt_id,
      ...(typeof generation === 'number' ? { executionGeneration: generation } : {})
    })
  }
  if (PROMPT_SETTLED.has(event.type) && typeof payload.prompt_id === 'string') {
    store.settle(payload.prompt_id, 'settled')
  }
  if (event.type === 'request.cancel' && typeof payload.id === 'string') {
    store.settle(payload.id, 'cancelled')
  }
  if (event.type === 'approval.cancelled') {
    for (const id of stringList(payload.request_ids) ?? []) store.settle(id, 'cancelled')
  }
}
