import type {
  GroupActivityView,
  GroupPreview,
  GroupTurnAction,
  GroupView,
  HermesRoom,
  HermesRoomEvent,
  HermesRoomState
} from './types.js'

const STALL_MS = 120_000
const PREVIEW_MAX = 80

/** A member counts as stalled when it has been `running` for 2 minutes with no progress. */
function activityViews(state: HermesRoomState | undefined, nowMs: number): GroupActivityView[] {
  return (state?.driver_status?.member_activity ?? []).map(a => {
    const since = a.progress_at ?? a.started_at
    return {
      memberId: a.member_id,
      status: a.status,
      tool: a.tool ?? null,
      stalled: a.status === 'running' && since !== undefined && nowMs - since * 1000 > STALL_MS
    }
  })
}

function turnActionsOf(state: HermesRoomState | undefined): GroupTurnAction[] {
  const out: GroupTurnAction[] = []
  for (const a of state?.driver_status?.pending_actions ?? []) {
    if (a.kind === 'approval') continue
    out.push({ memberId: a.member_id, kind: a.kind, taskId: a.task_id, executionGeneration: a.execution_generation })
  }
  return out
}

export function toGroupView(room: HermesRoom, state: HermesRoomState | undefined, preview: GroupPreview | null, nowMs: number): GroupView {
  // The list can lag a rename or a seq bump that `groups.state` already shows; revision orders them.
  const fresh = state && state.room.revision >= room.revision ? state.room : room
  const ctx = state?.context
  const status = state?.driver_status
  const activity = activityViews(state, nowMs)
  return {
    id: room.room_id,
    name: fresh.name,
    members: fresh.members.map(m => ({ memberId: m.member_id, profile: m.profile, handle: m.handle, displayName: m.display_name ?? null })),
    routing: ctx?.routing ?? 'everyone',
    leadMemberId: ctx?.lead_member_id ? ctx.lead_member_id : null,
    purpose: ctx?.purpose ?? '',
    notes: ctx?.notes ?? '',
    latestSeq: fresh.latest_seq ?? room.latest_seq ?? 0,
    epoch: fresh.authority_epoch,
    updatedAt: fresh.updated_at * 1000,
    working: Boolean(status?.working) || activity.some(a => a.status === 'running' || a.status === 'stopping'),
    activity,
    turnActions: turnActionsOf(state),
    maxContinues: status?.max_continues ?? 5,
    maxRounds: status?.max_rounds ?? 3,
    preview
  }
}

export function previewFrom(events: readonly HermesRoomEvent[]): GroupPreview | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (!e) continue
    if (e.kind !== 'message.user' && e.kind !== 'message.member') continue
    const raw = typeof e.payload.text === 'string' ? e.payload.text : ''
    const line = raw.split('\n').map(l => l.trim()).find(l => l !== '') ?? ''
    const text = line.length > PREVIEW_MAX ? `${line.slice(0, PREVIEW_MAX - 1)}…` : line
    if (e.kind === 'message.member') return { speaker: { kind: 'member', memberId: e.actor.id }, text }
    if (e.actor.id === 'desktop') return { speaker: { kind: 'user' }, text }
    return { speaker: { kind: 'other', label: e.actor.display_name ?? e.actor.id }, text }
  }
  return null
}

export function isActive(state: HermesRoomState | undefined): boolean {
  const s = state?.driver_status
  return Boolean(s && (s.working || s.member_activity.length > 0 || s.pending_actions.length > 0))
}
