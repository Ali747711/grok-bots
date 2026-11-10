import type { BotView, CrewState } from '@/state/types'

export function bot(over: Partial<BotView> & { name: string }): BotView {
  return {
    title: over.name, color: null, shape: null, isPrimary: false, hasAvatar: false, avatar: null, imageKind: null, model: null,
    sessionId: null, preview: null, lastActive: null, status: 'idle',
    hidden: false, pinned: false, role: null, job: '', setupIncomplete: false, created: null, ...over
  }
}

export function crewState(over: Partial<CrewState> = {}): CrewState {
  return {
    hermes: 'connected',
    bots: [
      bot({ name: 'researcher', title: 'Researcher', preview: 'Needs approval', status: 'needs_you' }),
      bot({ name: 'default', title: 'Hermes', isPrimary: true, preview: 'Working on it', status: 'working' }),
      bot({ name: 'dev', title: 'Dev', preview: 'Idle', shape: 'circle' })
    ],
    pending: [],
    ...over
  }
}

import type { GroupView } from '@/state/types'

export function group(over: Partial<GroupView> & { id: string }): GroupView {
  return {
    name: over.id, members: [], routing: 'auto', leadMemberId: null, purpose: '', notes: '', latestSeq: 0, epoch: 1, updatedAt: 0,
    working: false, stuck: false, stuckReason: null, prepareRetry: null, lastError: null, activity: [], turnActions: [], maxContinues: 5, maxRounds: 3, preview: null, ...over
  }
}

export const gm = (profile: string): GroupView['members'][number] => ({ memberId: profile, profile, handle: profile, displayName: null })
