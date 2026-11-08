import { useState } from 'react'

import { Settings } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { SettingsDialog } from '@/features/settings/SettingsDialog'
import { CreditPillView, useUsage } from '@/features/usage/CreditPill'

/** Credit pill, settings button and dialog. Polls credit once and shares it with both. */
export function RosterFooter({ maxWorkingBots }: { maxWorkingBots: number | null }) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const usage = useUsage()
  return (
    <>
      <Separator className="mt-2" />
      <div className="flex items-center gap-2 pt-2.5">
        <CreditPillView usage={usage} />
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => setSettingsOpen(true)} className="ml-auto text-muted-foreground">
          <Settings />
        </Button>
      </div>
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} maxWorkingBots={maxWorkingBots} usage={usage} />
    </>
  )
}
