import type { BotPanel } from '@/app/panel-params'
import { Skeleton } from '@/components/ui/skeleton'
import { submitAnswer } from '@/features/requests/answer-request'
import { RequestCard } from '@/features/requests/RequestCard'
import type { BotView, CrewState } from '@/state/types'

import { useBotChat } from './chat-session-context'
import { ChatHeader } from './ChatHeader'
import { Composer } from './Composer'
import { composerDisabledReason, DEFAULT_MAX_WORKING_BOTS } from './disabled-reason'
import { draftKey } from './draft-store'
import { MessageList } from './MessageList'

interface ChatViewProps {
  bot: BotView
  state: CrewState
  /** Browser-to-Crew stream is up. */
  crewConnected: boolean
  panel?: BotPanel | null
  /** A header button was clicked: the panel to show next, or null to close the open one. */
  onPanel?: (next: BotPanel | null) => void
}

function ChatSkeleton() {
  return (
    <div data-testid="chat-skeleton" aria-hidden="true" className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-6">
      <Skeleton className="h-12 w-2/3" />
      <Skeleton className="ml-auto h-9 w-1/3" />
      <Skeleton className="h-16 w-3/4" />
    </div>
  )
}

/** One bot's chat: header, transcript, composer. The session itself is opened above the shell (ChatSessionProvider). */
export function ChatView({ bot, state, crewConnected, panel = null, onPanel }: ChatViewProps) {
  const { session, items, canSend, connected, running, loaded, notice } = useBotChat(bot.name)
  const stale = state.hermes !== 'connected' || !crewConnected
  const othersWorking = state.bots.filter(b => b.name !== bot.name && b.status === 'working').length
  // Oldest first; they leave when Hermes settles them (they drop out of state.pending).
  const requests = state.pending.filter(p => p.profile === bot.name && p.source !== 'group').sort((a, b) => a.receivedAt - b.receivedAt)
  const reason = composerDisabledReason({ hermes: state.hermes, crewConnected, canSend,
    othersWorking,
    maxWorkingBots: state.settings ? state.settings.maxWorkingBots : DEFAULT_MAX_WORKING_BOTS
  })

  return (
    <>
      <ChatHeader bot={bot} stale={stale} panel={panel} onPanel={onPanel} />
      {!loaded && items.length === 0 && !stale ? <ChatSkeleton /> : <MessageList items={items} onRetry={id => void session?.retry(id).catch(() => undefined)} />}
      {notice && <p role="status" className="px-6 text-center text-xs text-muted-foreground">{notice}</p>}
      {requests.length > 0 && (
        <div className="max-h-[40vh] flex-none overflow-y-auto px-6 pt-2">
          <div className="mx-auto flex max-w-[720px] flex-col gap-2">
            {requests.map(entry => <RequestCard key={entry.id} entry={entry} botTitle={bot.title} onAnswer={(e, body) => submitAnswer(e.id, body)} />)}
          </div>
        </div>
      )}
      <Composer
        draftKey={draftKey.bot(bot.name)}
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
