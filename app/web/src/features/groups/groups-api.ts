import { crewFetch } from '@/lib/crew-api'
import type { GroupEvent, Routing } from '@/state/types'

/** A non-2xx answer from a groups route; `message` is plain words, never the raw code. */
export class GroupApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    /** For `bad_members`: why, and which profile. */
    readonly reason?: string,
    readonly profile?: string
  ) {
    super(message)
    this.name = 'GroupApiError'
  }
}

export type SendResult = { kind: 'accepted'; seq: number } | { kind: 'refused'; reason: string } | { kind: 'unknown' }

export interface GroupEventsPage {
  events: GroupEvent[]
  cursor: number
  latestSeq: number
  hasMore: boolean
  epoch: number
}

const GENERIC_ERROR = 'Something went wrong. Try again.'
const ERROR_TEXT: Readonly<Record<string, string>> = {
  hermes_offline: 'Hermes is offline',
  not_found: 'That group no longer exists',
  groups_unavailable: 'Group chats are not available right now',
  bad_members: 'Pick two to six bots that can join a group',
  bad_body: GENERIC_ERROR,
  no_such_action: 'That is no longer available',
  still_stopping: 'The group is still stopping. Try again in a moment.'
}

/** Hermes's own words (`detail`) pass through for `hermes_refused`; every other code becomes readable text. */
function errorText(code: string, detail: unknown): string {
  if (code === 'hermes_refused' && typeof detail === 'string' && detail) return detail
  return ERROR_TEXT[code] ?? GENERIC_ERROR
}

async function groupError(res: Response): Promise<GroupApiError> {
  const parsed = (await res.json().catch(() => null)) as { error?: unknown; detail?: unknown; reason?: unknown; profile?: unknown } | null
  const code = typeof parsed?.error === 'string' ? parsed.error : 'unknown'
  const reason = typeof parsed?.reason === 'string' ? parsed.reason : undefined
  const profile = typeof parsed?.profile === 'string' ? parsed.profile : undefined
  return new GroupApiError(res.status, code, errorText(code, parsed?.detail), reason, profile)
}

const roomPath = (roomId: string, tail = ''): string => `/crew/groups/${encodeURIComponent(roomId)}${tail}`

async function call(path: string, method: string, body?: unknown): Promise<Response> {
  const res = await crewFetch(path, {
    method,
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  })
  if (!res.ok) throw await groupError(res)
  return res
}

async function callJson<T>(path: string, method: string, body?: unknown): Promise<T> {
  return (await (await call(path, method, body)).json()) as T
}

export const createGroup = (body: { name?: string; members: string[] }): Promise<{ roomId: string; routing: Routing; warning?: 'routing_not_set' }> =>
  callJson('/crew/groups', 'POST', body)

export const fetchGroupEvents = (roomId: string, since: number, limit = 100): Promise<GroupEventsPage> =>
  callJson(roomPath(roomId, `/events?since=${since}&limit=${limit}`), 'GET')

/** Never throws: a 409 or an offline Hermes means nothing was stored; 502 or a dead network leaves it unknown. */
export async function sendGroupMessage(roomId: string, body: { eventId: string; text: string; threadId?: string }): Promise<SendResult> {
  try {
    const res = await crewFetch(roomPath(roomId, '/messages'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const parsed = (await res.json().catch(() => null)) as { seq?: unknown; reason?: unknown; error?: unknown } | null
    if (res.ok && typeof parsed?.seq === 'number') return { kind: 'accepted', seq: parsed.seq }
    if (res.status === 503 && parsed?.error === 'hermes_offline') return { kind: 'refused', reason: 'hermes_offline' }
    if (res.status === 409) return { kind: 'refused', reason: typeof parsed?.reason === 'string' ? parsed.reason : 'refused' }
    return { kind: 'unknown' }
  } catch {
    return { kind: 'unknown' }
  }
}

export const stopGroup = (roomId: string, cancelId: string): Promise<{ cancelled: boolean }> => callJson(roomPath(roomId, '/stop'), 'POST', { cancelId })

export async function continueGroup(roomId: string, discussionEventId: string): Promise<void> {
  await call(roomPath(roomId, '/continue'), 'POST', { discussionEventId })
}

export interface TurnTarget {
  memberId: string
  taskId: string
  executionGeneration: number
}

export async function retryTurn(roomId: string, turn: TurnTarget): Promise<void> {
  await call(roomPath(roomId, '/turns/retry'), 'POST', turn)
}

export async function discardTurn(roomId: string, turn: TurnTarget): Promise<void> {
  await call(roomPath(roomId, '/turns/discard'), 'POST', turn)
}

export const renameGroup = (roomId: string, name: string): Promise<{ name: string }> => callJson(roomPath(roomId), 'PATCH', { name })

export const setGroupContext = (
  roomId: string,
  body: { routing: Routing; leadMemberId?: string; purpose: string; notes: string }
): Promise<{ routing: Routing; leadMemberId: string | null; purpose: string; notes: string }> => callJson(roomPath(roomId, '/context'), 'PUT', body)

export async function deleteGroup(roomId: string): Promise<void> {
  await call(roomPath(roomId), 'DELETE')
}
