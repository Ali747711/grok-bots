import { X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ComputerPanel } from '@/features/computer/ComputerPanel'
import { ProfilePanel } from '@/features/bots/ProfilePanel'
import { RoutinesPanel } from '@/features/routines/RoutinesPanel'
import type { BotView } from '@/state/types'

export type PanelTab = 'computer' | 'routines' | 'profile'

export const isPanelTab = (v: string | null): v is PanelTab => v === 'computer' || v === 'routines' || v === 'profile'

interface BotPanelProps {
  bot: BotView
  tab: PanelTab
  /** A tab was clicked (the caller keeps the choice in the `?panel=` search param). */
  onTab?: (tab: PanelTab) => void
  onClose?: () => void
}

/** Right-hand panel for one bot: Computer, Routines and Profile tabs, with a close button when the caller can close it. */
export function BotPanel({ bot, tab, onTab, onClose }: BotPanelProps) {
  return (
    <Tabs value={tab} onValueChange={v => isPanelTab(String(v)) && onTab?.(v as PanelTab)} className="min-h-0 flex-1 gap-0 overflow-y-auto">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <TabsList>
          <TabsTrigger value="computer" className="data-active:bg-foreground data-active:text-background dark:data-active:border-foreground dark:data-active:bg-foreground dark:data-active:text-background">Computer</TabsTrigger>
          <TabsTrigger value="routines" className="data-active:bg-foreground data-active:text-background dark:data-active:border-foreground dark:data-active:bg-foreground dark:data-active:text-background">Routines</TabsTrigger>
          <TabsTrigger value="profile" className="data-active:bg-foreground data-active:text-background dark:data-active:border-foreground dark:data-active:bg-foreground dark:data-active:text-background">Profile</TabsTrigger>
        </TabsList>
        {onClose && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Close panel" onClick={onClose}>
            <X />
          </Button>
        )}
      </div>
      <TabsContent value="computer" className="flex min-h-0 flex-col"><ComputerPanel key={bot.name} bot={bot} /></TabsContent>
      <TabsContent value="routines" className="flex min-h-0 flex-col"><RoutinesPanel key={bot.name} bot={bot} /></TabsContent>
      <TabsContent value="profile" className="flex min-h-0 flex-col"><ProfilePanel key={bot.name} bot={bot} /></TabsContent>
    </Tabs>
  )
}
