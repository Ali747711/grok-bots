import { useChatSession } from '@/features/chat/use-chat-session'
import type { BotView, CrewState } from '@/state/types'

import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { composerDisabledReason } from './disabled-reason'
import { MessageList } from './MessageList'

interface ChatViewProps {
  bot: BotView
  state: CrewState
  /** Browser-to-Crew stream is up. */
  crewConnected: boolean
}

/** One bot's chat: header, transcript, composer. */
export function ChatView({ bot, state, crewConnected }: ChatViewProps) {
  const { session, items, canSend, running, notice } = useChatSession(bot)
  const stale = state.hermes !== 'connected' || !crewConnected
  const othersWorking = state.bots.filter(b => b.name !== bot.name && b.status === 'working').length
  const reason = composerDisabledReason({ hermes: state.hermes, crewConnected, canSend, othersWorking })

  return (
    <>
      <ChatHeader bot={bot} stale={stale} />
      <MessageList items={items} />
      {notice && <p role="status" className="px-6 text-center text-xs text-muted-foreground">{notice}</p>}
      <Composer
        disabledReason={reason}
        running={running}
        // A rejected send already shows a "Not sent" notice in the transcript.
        onSend={text => void session?.send(text).catch(() => undefined)}
        onStop={() => void session?.stop().catch(() => undefined)}
      />
    </>
  )
}
