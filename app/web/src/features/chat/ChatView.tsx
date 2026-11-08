import { submitAnswer } from '@/features/requests/answer-request'
import { RequestCard } from '@/features/requests/RequestCard'
import { useChatSession } from '@/features/chat/use-chat-session'
import type { BotView, CrewState } from '@/state/types'

import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { composerDisabledReason, DEFAULT_MAX_WORKING_BOTS } from './disabled-reason'
import { MessageList } from './MessageList'

interface ChatViewProps {
  bot: BotView
  state: CrewState
  /** Browser-to-Crew stream is up. */
  crewConnected: boolean
}

/** One bot's chat: header, transcript, composer. */
export function ChatView({ bot, state, crewConnected }: ChatViewProps) {
  const { session, items, canSend, connected, running, notice } = useChatSession(bot)
  const stale = state.hermes !== 'connected' || !crewConnected
  const othersWorking = state.bots.filter(b => b.name !== bot.name && b.status === 'working').length
  // Oldest first; they leave when Hermes settles them (they drop out of state.pending).
  const requests = state.pending.filter(p => p.profile === bot.name).sort((a, b) => a.receivedAt - b.receivedAt)
  const reason = composerDisabledReason({ hermes: state.hermes, crewConnected, canSend,
    othersWorking,
    maxWorkingBots: state.settings ? state.settings.maxWorkingBots : DEFAULT_MAX_WORKING_BOTS
  })

  return (
    <>
      <ChatHeader bot={bot} stale={stale} />
      <MessageList items={items} onRetry={id => void session?.retry(id).catch(() => undefined)} />
      {notice && <p role="status" className="px-6 text-center text-xs text-muted-foreground">{notice}</p>}
      {requests.length > 0 && (
        <div className="max-h-[40vh] flex-none overflow-y-auto px-6 pt-2">
          <div className="mx-auto flex max-w-[720px] flex-col gap-2">
            {requests.map(entry => <RequestCard key={entry.id} entry={entry} onAnswer={(e, body) => submitAnswer(e.id, body)} />)}
          </div>
        </div>
      )}
      <Composer
        disabledReason={reason}
        running={running}
        stopDisabled={!connected}
        // A rejected send already shows a "Not sent" notice in the transcript.
        onSend={text => void session?.send(text).catch(() => undefined)}
        onStop={() => void session?.stop()}
      />
    </>
  )
}
