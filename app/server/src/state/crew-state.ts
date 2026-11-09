import { answerGroupApproval, hideGroupDuplicates, syncGroupPending } from '../groups/group-pending.js'
import type { GroupRpc } from '../groups/group-rpc.js'
import type { GroupWatcher } from '../groups/group-watcher.js'
import { log as logger } from '../log.js'
import type { BotView, CrewState } from '../watcher/bot-state.js'
import type { Watcher } from '../watcher/watcher.js'

export type CrewStateSource = Pick<Watcher, 'onChange' | 'answer' | 'store' | 'getAvatar' | 'debug'> & { state(): CrewState }

const BUSY = new Set(['running', 'stopping'])

/**
 * The watcher's state plus group rooms: group approvals join Needs you (answerable through
 * `groups.approve`), and a bot running a turn in any room shows as working.
 */
export function composeCrewState(watcher: Pick<Watcher, 'state' | 'onChange' | 'answer' | 'store' | 'getAvatar' | 'debug'>, groups: GroupWatcher, rpc: GroupRpc, now: () => number): CrewStateSource {
  const sync = () => syncGroupPending(watcher.store, groups.pendingActions(), now())
  // Runs with no SSE client attached; store writes reach clients through the watcher's own debounce.
  groups.onChange(sync)

  const state = (): CrewState => {
    const base = watcher.state()
    const groupsState = groups.state()
    const busy = new Set(groupsState.rooms.flatMap(r => r.activity.filter(a => BUSY.has(a.status)).map(a => a.memberId)))
    const bots: readonly BotView[] = base.bots.map(b => (b.status === 'idle' && busy.has(b.name) ? { ...b, status: 'working' as const } : b))
    const pending = hideGroupDuplicates(base.pending.map(p => (p.source === 'group' ? { ...p, answerable: true } : p)))
    return { ...base, bots, pending, groups: groupsState }
  }

  const deliver = async (id: string, choice: string): Promise<void> => {
    const entry = watcher.store.get(id)
    if (!entry?.group) return
    try {
      await answerGroupApproval(rpc, entry, choice)
      logger.info('group answer sent', { id, profile: entry.profile, choice })
      void groups.refreshRoom(entry.group.roomId)
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 200) : 'send_failed'
      logger.warn('group answer failed', { id, reason })
      watcher.store.markAnswer(id, 'failed', reason)
    }
  }

  return {
    state,
    store: watcher.store,
    onChange: listener => {
      const offs = [watcher.onChange(listener), groups.onChange(listener)]
      return () => {
        for (const off of offs) off()
      }
    },
    getAvatar: name => watcher.getAvatar(name),
    debug: () => watcher.debug(),
    answer: (id, input) => {
      const entry = watcher.store.get(id)
      if (entry?.source !== 'group') return watcher.answer(id, input)
      if (entry.settled) return 'already_resolved'
      if (entry.answerState === 'answering') return 'answering'
      if (watcher.state().hermes !== 'connected') {
        watcher.store.markAnswer(id, 'failed', 'not_connected')
        return 'offline'
      }
      watcher.store.markAnswer(id, 'answering')
      void deliver(id, 'choice' in input ? input.choice : '')
      return 'sent'
    }
  }
}
