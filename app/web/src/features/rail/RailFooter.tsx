import { useCallback, useState } from 'react'

import { Blocks, Settings } from 'lucide-react'

import { IconButton } from '@/components/console/icon-button'
import { AppsDialog } from '@/features/apps/AppsDialog'
import { type CrewDialog, useDialogRequests } from '@/features/apps/open-dialog'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { CreditPillView, useUsage } from '@/features/usage/CreditPill'
import type { BotView } from '@/state/types'

import { ThemeMenu } from './ThemeMenu'

interface RailFooterProps {
  bots: readonly BotView[]
  maxWorkingBots: number | null
}

/** Credit pill, then Apps, Settings and the theme menu. Polls credit once and shares it with the Settings dialog. */
export function RailFooter({ bots, maxWorkingBots }: RailFooterProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appsOpen, setAppsOpen] = useState(false)
  const usage = useUsage()
  useDialogRequests(useCallback((which: CrewDialog) => (which === 'apps' ? setAppsOpen : setSettingsOpen)(true), []))
  return (
    <>
      <footer className="flex items-center gap-0.5 px-1 pt-2.5">
        <div className="mr-auto min-w-0">
          <CreditPillView usage={usage} />
        </div>
        <IconButton label="Apps" onClick={() => setAppsOpen(true)}>
          <Blocks />
        </IconButton>
        <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
          <Settings />
        </IconButton>
        <ThemeMenu />
      </footer>
      <AppsDialog open={appsOpen} onOpenChange={setAppsOpen} bots={bots} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} maxWorkingBots={maxWorkingBots} usage={usage} />
    </>
  )
}
