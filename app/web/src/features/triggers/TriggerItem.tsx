import { useState } from 'react'
import { toast } from 'sonner'

import { Switch } from '@/components/console/fields'
import type { RoutineView } from '@/features/routines/types'

import { OutcomeBadge } from './outcome-format'
import { TriggerMenu } from './TriggerMenu'
import { triggerErrorText, updateTrigger, warnUnsaved } from './triggers-api'
import type { TriggerView } from './types'

interface TriggerItemProps {
  trigger: TriggerView
  /** Null for a trigger whose routine was deleted. */
  routine: RoutineView | null
  onChanged: () => void
}

/** One trigger: name, source, on/off switch and the outcome of its last event. */
export function TriggerItem({ trigger, routine, onChanged }: TriggerItemProps) {
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
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-xl bg-shell py-2 pr-1.5 pl-3 text-sm">
      <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{trigger.name}</span>
      <span className="shrink-0 text-xs font-medium text-muted-foreground">{trigger.source === 'github' ? 'GitHub' : 'Generic'}</span>
      <Switch checked={trigger.enabled} disabled={busy} onChange={v => void toggle(v)} label={`${trigger.name} on`} />
      <TriggerMenu trigger={trigger} routine={routine} onChanged={onChanged} />
      <div className="basis-full pb-0.5">
        {trigger.lastEvent ? <OutcomeBadge outcome={trigger.lastEvent.outcome} /> : <span className="text-xs font-medium text-muted-foreground">No events yet</span>}
      </div>
    </div>
  )
}
