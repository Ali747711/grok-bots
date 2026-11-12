import { type ReactNode, createContext, useContext } from 'react'

import type { UseScreen } from '@/features/computer/use-screen'
import { type LiveHandle, useComputer } from '@/features/computer/use-live-view'
import type { BotView } from '@/state/types'

export interface ComputerContextValue {
  readonly screen: UseScreen
  readonly live: LiveHandle
}

const ComputerContext = createContext<ComputerContextValue | null>(null)

/**
 * The one owner of a bot's screen state and viewer (`useComputer`), shared by the header's link chip
 * and the Screen tab. Mount it only while the Screen tab shows: unmounting it (another tab, Close
 * panel, another bot) hands control back if the user holds it and closes the viewer (spec §6.3).
 */
export function ComputerProvider({ bot, children }: { bot: BotView; children: ReactNode }) {
  const computer = useComputer(bot.name)
  return <ComputerContext.Provider value={computer}>{children}</ComputerContext.Provider>
}

export function useComputerContext(): ComputerContextValue {
  const value = useContext(ComputerContext)
  if (!value) throw new Error('useComputerContext needs a ComputerProvider above it')
  return value
}
