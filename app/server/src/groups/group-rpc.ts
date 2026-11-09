import { randomUUID } from 'node:crypto'

import { HermesRpcError, type Rpc } from '../hermes/errors.js'
import {
  GROUP_OWNER_PROFILE,
  type HermesCapabilities,
  type HermesRoom,
  type HermesRoomContext,
  type HermesRoomLog,
  type HermesRoomMember,
  type HermesRoomState,
  type Routing
} from './types.js'

const LIST_PAGE = 100

interface TurnRef {
  memberId: string
  taskId: string
  executionGeneration: number
}

export interface GroupRpc {
  capabilities(): Promise<HermesCapabilities>
  list(): Promise<HermesRoom[]>
  state(roomId: string): Promise<HermesRoomState>
  log(roomId: string, sinceSeq: number, limit: number): Promise<HermesRoomLog>
  create(input: { roomId: string; name: string; members: HermesRoomMember[] }): Promise<HermesRoom>
  setContext(roomId: string, ctx: { routing: Routing; leadMemberId: string; purpose: string; notes: string }): Promise<HermesRoomContext>
  rename(roomId: string, name: string): Promise<HermesRoom>
  send(roomId: string, input: { eventId: string; text: string; threadId: string }): Promise<{ seq: number }>
  stop(roomId: string, cancelId: string): Promise<{ cancelled: number }>
  continueDiscussion(roomId: string, discussionEventId: string): Promise<void>
  approve(roomId: string, a: TurnRef & { choice: 'once' | 'deny'; requestId: string }): Promise<void>
  retry(roomId: string, t: TurnRef): Promise<void>
  discard(roomId: string, t: TurnRef): Promise<void>
  disband(roomId: string, cancelId: string): Promise<void>
}

/** Typed `groups.*` calls. Hermes refuses unknown keys, so each method sends exactly its own set. */
export function createGroupRpc(rpc: Rpc, newId: () => string = randomUUID): GroupRpc {
  const call = <T>(method: string, params: Record<string, unknown> = {}): Promise<T> =>
    rpc<T>(method, { profile: GROUP_OWNER_PROFILE, ...params })
  const turn = (roomId: string, t: TurnRef) => ({
    room_id: roomId,
    member_id: t.memberId,
    task_id: t.taskId,
    execution_generation: t.executionGeneration
  })

  return {
    capabilities: () => call<HermesCapabilities>('groups.capabilities'),
    async list() {
      const rooms: HermesRoom[] = []
      let offset: number | null = 0
      while (offset !== null) {
        const page: { rooms: HermesRoom[]; next_offset: number | null } = await call('groups.list', {
          limit: LIST_PAGE,
          ...(offset > 0 ? { offset } : {})
        })
        rooms.push(...page.rooms)
        offset = typeof page.next_offset === 'number' && page.rooms.length > 0 ? page.next_offset : null
      }
      return rooms
    },
    state: roomId => call<HermesRoomState>('groups.state', { room_id: roomId }),
    log: (roomId, sinceSeq, limit) => call<HermesRoomLog>('groups.log', { room_id: roomId, since_seq: sinceSeq, limit }),
    async create({ roomId, name, members }) {
      return (await call<{ room: HermesRoom }>('groups.create', { room_id: roomId, name, members })).room
    },
    async setContext(roomId, ctx) {
      const r = await call<{ context: HermesRoomContext }>('groups.context', {
        room_id: roomId,
        event_id: `crew-${newId()}`,
        purpose: ctx.purpose,
        notes: ctx.notes,
        routing: ctx.routing,
        lead_member_id: ctx.leadMemberId
      })
      return r.context
    },
    async rename(roomId, name) {
      return (await call<{ room: HermesRoom }>('groups.rename', { room_id: roomId, event_id: `crew-${newId()}`, name })).room
    },
    async send(roomId, { eventId, text, threadId }) {
      const r = await call<{ event: { seq: number } }>('groups.send', {
        room_id: roomId,
        event_id: eventId,
        payload: { text, thread_id: threadId }
      })
      return { seq: r.event.seq }
    },
    async stop(roomId, cancelId) {
      const r = await call<{ cancelled: number }>('groups.stop', { room_id: roomId, cancel_id: cancelId })
      return { cancelled: r.cancelled }
    },
    async continueDiscussion(roomId, discussionEventId) {
      await call('groups.continue', { room_id: roomId, discussion_event_id: discussionEventId })
    },
    async approve(roomId, a) {
      await call('groups.approve', { ...turn(roomId, a), choice: a.choice, request_id: a.requestId })
    },
    async retry(roomId, t) {
      await call('groups.retry', turn(roomId, t))
    },
    async discard(roomId, t) {
      await call('groups.discard', turn(roomId, t))
    },
    async disband(roomId, cancelId) {
      await call('groups.disband', { room_id: roomId, cancel_id: cancelId })
    }
  }
}

/** Hermes refusals carry `data: {reason, detail?, admitted?}`; null for anything else. */
export function groupErrorReason(error: unknown): { reason: string; detail?: string; admitted?: boolean } | null {
  if (!(error instanceof HermesRpcError)) return null
  const data = error.data
  if (!data || typeof data !== 'object') return null
  const { reason, detail, admitted } = data as { reason?: unknown; detail?: unknown; admitted?: unknown }
  if (typeof reason !== 'string') return null
  return {
    reason,
    ...(typeof detail === 'string' ? { detail } : {}),
    ...(typeof admitted === 'boolean' ? { admitted } : {})
  }
}
