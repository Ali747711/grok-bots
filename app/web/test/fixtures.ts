import type { BotView, CrewState } from '@/state/types'

export function bot(over: Partial<BotView> & { name: string }): BotView {
  return {
    title: over.name, color: null, shape: null, isPrimary: false, hasAvatar: false, avatar: null, imageKind: null, model: null,
    sessionId: null, preview: null, lastActive: null, status: 'idle',
    hidden: false, setupIncomplete: false, created: null, ...over
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
