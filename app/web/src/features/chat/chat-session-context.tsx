import { type ReactNode, createContext, useContext } from 'react'

import type { BotView } from '@/state/types'

import { type ChatSnapshot, type OwnedChat, EMPTY_CHAT, useChatSession } from './use-chat-session'

const NO_CHAT: OwnedChat = { name: null, snapshot: EMPTY_CHAT }
const ChatSessionContext = createContext<OwnedChat>(NO_CHAT)

/**
 * Opens the selected bot's chat session above the shell, so it stays open while the profile replaces
 * the conversation. `bot` is null on pages with no bot (a group, Needs you): no session is open then.
 */
export function ChatSessionProvider({ bot, children }: { bot: BotView | null; children: ReactNode }) {
  const chat = useChatSession(bot)
  return <ChatSessionContext.Provider value={chat}>{children}</ChatSessionContext.Provider>
}

/** `name`'s chat. Empty (nothing to show, cannot send) while the provider holds another bot's session or none. */
export function useBotChat(name: string): ChatSnapshot {
  const chat = useContext(ChatSessionContext)
  return chat.name === name ? chat.snapshot : EMPTY_CHAT
}
