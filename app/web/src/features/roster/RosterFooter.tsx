import { useCallback, useState } from 'react'

import { Blocks, Settings } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { AppsDialog } from '@/features/apps/AppsDialog'
import { useDialogRequests, type CrewDialog } from '@/features/apps/open-dialog'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { CreditPillView, useUsage } from '@/features/usage/CreditPill'

/** Credit pill, settings button and dialog. Polls credit once and shares it with both. */
export function RosterFooter({ maxWorkingBots }: { maxWorkingBots: number | null }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [appsOpen, setAppsOpen] = useState(false)
  const usage = useUsage()
  useDialogRequests(useCallback((which: CrewDialog) => (which === 'apps' ? setAppsOpen : setSettingsOpen)(true), []))
  return (
    <>
      <Separator className="mt-2" />
      <div className="flex items-center gap-2 pt-2.5">
        <CreditPillView usage={usage} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Apps" onClick={() => setAppsOpen(true)} className="ml-auto text-muted-foreground">
          <Blocks />
        </Button>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => setSettingsOpen(true)} className="text-muted-foreground">
          <Settings />
        </Button>
      </div>
      <AppsDialog open={appsOpen} onOpenChange={setAppsOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} maxWorkingBots={maxWorkingBots} usage={usage} />
    </>
  )
}
