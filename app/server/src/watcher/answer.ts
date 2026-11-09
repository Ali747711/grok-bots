import type { ServerRequest } from '../vendor/hermes/json-rpc-channel.js'
import type { PendingRequest } from './pending-store.js'
import type { WatcherClient } from './watcher.js'

export type AnswerInput = { readonly choice: string } | { readonly answer: string } | { readonly value: string }

/** Approvals wait up to 1800 s in Hermes; keep the RPC open slightly longer. */
export const ANSWER_TIMEOUT_MS = 1_830_000

export interface AnswerContext {
  readonly client: Pick<WatcherClient, 'request'>
  /** The live `srq-…` request, when Hermes asked through the legacy server-request channel. */
  readonly serverRequest?: ServerRequest
  /** Called right after the answer is handed to Hermes (before any reply is awaited). */
  readonly onSent?: (method: 'approval.respond' | 'clarify.respond' | 'server_request.respond') => void
}

interface PromptResult {
  status?: 'resolved' | 'already_resolved'
}

/**
 * Deliver the user's answer to Hermes: the only code path that answers anything. Prompt-based
 * entries go through `*.respond`; held server requests are answered on their own request object.
 * Never calls `fail`/`decline` (Hermes would treat either as "skipped" for everyone).
 */
export async function answerRequest(
  entry: PendingRequest,
  input: AnswerInput,
  ctx: AnswerContext
): Promise<'resolved' | 'already_resolved'> {
  if (ctx.serverRequest) {
    ctx.serverRequest.respond(input)
    ctx.onSent?.('server_request.respond')
    return 'resolved'
  }
  if (!entry.promptId || entry.executionGeneration === undefined) throw new Error('not_answerable')
  // Hermes routes an RPC by profile: without it the call lands on the default profile's connection,
  // where this session is not subscribed (not_found).
  if (entry.profile === 'unknown') throw new Error('not_answerable')
  const base = { profile: entry.profile, session_id: entry.sessionId, execution_generation: entry.executionGeneration, prompt_id: entry.promptId }
  const [method, params] =
    'choice' in input
      ? ['approval.respond', { ...base, choice: input.choice }]
      : 'answer' in input
        ? ['clarify.respond', { ...base, answer: input.answer }]
        : [undefined, undefined]
  if (!method || !params) throw new Error('not_answerable')
  const pending = ctx.client.request<PromptResult>(method, params, ANSWER_TIMEOUT_MS)
  ctx.onSent?.(method as 'approval.respond' | 'clarify.respond')
  const result = await pending
  return result?.status === 'already_resolved' ? 'already_resolved' : 'resolved'
}
