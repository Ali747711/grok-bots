import type { PendingStore, PendingRequest } from '../watcher/pending-store.js'
import type { PendingView } from '../watcher/bot-state.js'
import { approvalDetail, summarize } from '../watcher/request-router.js'

import type { GroupRpc } from './group-rpc.js'
import type { HermesPendingAction } from './types.js'

export const groupPendingId = (roomId: string, requestId: string): string => `group:${roomId}:${requestId}`

/**
 * Mirror each room's approval actions into the Needs-you store. An open group entry is settled when
 * its room left the map or its action left the room's list; a failed poll keeps the previous actions,
 * so its entries stay.
 */
export function syncGroupPending(store: PendingStore, actions: ReadonlyMap<string, readonly HermesPendingAction[]>, now: number): void {
  const live = new Set<string>()
  for (const [roomId, list] of actions) {
    for (const action of list) {
      if (action.kind !== 'approval') continue
      const id = groupPendingId(roomId, action.request_id)
      live.add(id)
      if (store.get(id)) continue
      const params = { command: action.approval.command, description: action.approval.description }
      store.add({
        id,
        kind: 'approval',
        profile: action.member_id,
        sessionId: action.session_id,
        summary: summarize('approval', params),
        ...approvalDetail('approval', params),
        choices: ['once', 'deny'],
        receivedAt: now,
        source: 'group',
        executionGeneration: action.execution_generation,
        group: { roomId, memberId: action.member_id, taskId: action.task_id, requestId: action.request_id }
      })
    }
  }
  for (const entry of store.list()) {
    if (entry.source === 'group' && !live.has(entry.id)) store.settle(entry.id, 'settled')
  }
}

/** A group approval also shows up as an `unknown`-profile prompt on the member's hidden session; keep only the group one. */
export function hideGroupDuplicates(pending: readonly PendingView[]): PendingView[] {
  const groupSessions = new Set(pending.filter(p => p.source === 'group').map(p => p.sessionId))
  return pending.filter(p => !(p.profile === 'unknown' && p.source !== 'group' && groupSessions.has(p.sessionId)))
}

export async function answerGroupApproval(rpc: GroupRpc, entry: PendingRequest, choice: string): Promise<void> {
  if ((choice !== 'once' && choice !== 'deny') || !entry.group || entry.executionGeneration === undefined) throw new Error('not_answerable')
  const { roomId, memberId, taskId, requestId } = entry.group
  await rpc.approve(roomId, { memberId, taskId, executionGeneration: entry.executionGeneration, choice, requestId })
}
