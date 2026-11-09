import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { SWITCH } from '@/features/routines/row-styles'
import type { RoutineView } from '@/features/routines/types'

import { OutcomeBadge } from './outcome-format'
import { triggerErrorText, updateTrigger, warnUnsaved } from './triggers-api'
import type { TriggerView } from './types'

interface TriggerItemProps {
  trigger: TriggerView
  /** Null for a trigger whose routine was deleted. */
  routine: RoutineView | null
  onChanged: () => void
}

/** One trigger: name, source, on/off switch and the outcome of its last event. */
export function TriggerItem({ trigger, onChanged }: TriggerItemProps) {
  const [busy, setBusy] = useState(false)

  const toggle = async (enabled: boolean) => {
    setBusy(true)
    try {
      warnUnsaved(await updateTrigger(trigger.id, { enabled }))
    } catch (e) {
      toast.error(triggerErrorText(e))
    } finally {
      setBusy(false)
      onChanged()
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-card p-2.5 text-sm">
      <span className="min-w-0 flex-1 truncate font-medium">{trigger.name}</span>
      <Badge variant="outline" className="h-5 px-2 text-xs">{trigger.source === 'github' ? 'GitHub' : 'Generic'}</Badge>
      <Switch checked={trigger.enabled} disabled={busy} onCheckedChange={v => void toggle(v)} aria-label={`${trigger.name} on`} className={SWITCH} />
      <div className="basis-full">
        {trigger.lastEvent ? <OutcomeBadge outcome={trigger.lastEvent.outcome} /> : <span className="text-xs text-muted-foreground">No events yet</span>}
      </div>
    </div>
  )
}
