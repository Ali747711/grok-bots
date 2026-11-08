import { useEffect, useRef, useState } from 'react'

import { connectGateway } from '@/chat/gateway'
import { ChatSession } from '@/chat/chat-session'
import type { ChatItem } from '@/chat/types'
import type { BotView } from '@/state/types'

const RETRY_MIN_MS = 1000
const RETRY_MAX_MS = 15_000
const OPEN_FAILED = 'Couldn’t open the chat — retrying…'

export interface ChatSnapshot {
  session: ChatSession | null
  items: readonly ChatItem[]
  canSend: boolean
  running: boolean
  /** Quiet inline status ("Reconnecting to the chat…"), or null. */
  notice: string | null
}

const EMPTY: ChatSnapshot = { session: null, items: [], canSend: false, running: false, notice: null }

/** One ChatSession per open bot page: created on enter, closed on leave. */
export function useChatSession(bot: BotView): ChatSnapshot {
  const [snapshot, setSnapshot] = useState<ChatSnapshot>(EMPTY)
  const latestBot = useRef(bot)
  latestBot.current = bot

  useEffect(() => {
    const client = connectGateway()
    const session = new ChatSession(client, latestBot.current)
    let openError: string | null = null
    let cancelled = false
    const publish = () => {
      if (cancelled) return
      setSnapshot({ session, items: session.items, canSend: session.canSend, running: session.running, notice: openError ?? session.error })
    }
    const unsubscribe = session.subscribe(publish)

    const openWithRetry = async () => {
      for (let attempt = 0; !cancelled; attempt += 1) {
        try {
          await session.open()
          openError = null
          publish()
          return
        } catch {
          // While the socket is still connecting the session re-opens itself on `open`; only a failure on a live socket needs a retry.
          if (client.connectionState !== 'open') return
          openError = OPEN_FAILED
          publish()
          await new Promise(resolve => setTimeout(resolve, Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** attempt)))
        }
      }
    }
    publish()
    void openWithRetry()

    return () => {
      cancelled = true
      unsubscribe()
      session.close()
    }
  }, [bot.name])

  return snapshot
}
