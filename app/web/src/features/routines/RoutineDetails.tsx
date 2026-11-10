import { useState } from 'react'

import { Switch } from '@/components/console/fields'
import { Button } from '@/components/ui/button'
import { TriggerSection } from '@/features/triggers/TriggerSection'
import type { TriggerView } from '@/features/triggers/types'

import { GHOST } from './row-styles'
import { RunHistory } from './RunHistory'
import type { RoutineView } from './types'

interface RoutineDetailsProps {
  routine: RoutineView
  onChanged: () => void
  onEdit: () => void
  onToggle: () => void
  onDelete: () => void
  historyOpen: boolean
  onToggleHistory: () => void
  /** Changes when a run was just started, so an open history re-reads at once. */
  runTick: number
  triggerCount: number
  triggers?: readonly TriggerView[]
  sandboxed: boolean
}

function triggerWarning(count: number): string {
  return count === 1 ? 'This routine has 1 trigger; it will stop working.' : `This routine has ${count} triggers; they will stop working.`
}

function DeleteConfirm({ title, triggerCount, onDelete, onCancel }: { title: string; triggerCount: number; onDelete: () => void; onCancel: () => void }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-shell p-3">
      <p className="text-[13px] font-semibold">{`Delete “${title}”?`}</p>
      {triggerCount > 0 && <p className="text-xs font-medium text-muted-foreground">{triggerWarning(triggerCount)}</p>}
      <div className="flex gap-1.5">
        <Button type="button" size="sm" variant="destructive" onClick={onDelete}>Yes, delete</Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

/** What a routine row shows once opened: the pause switch, Edit, History, Delete, its triggers and its runs. */
export function RoutineDetails({ routine, onChanged, onEdit, onToggle, onDelete, historyOpen, onToggleHistory, runTick, triggerCount, triggers, sandboxed }: RoutineDetailsProps) {
  const [confirming, setConfirming] = useState(false)
  // A finished routine has nothing left to pause; a trigger-only one has no schedule to pause.
  const pausable = !routine.finished && !routine.triggerOnly

  return (
    <div className="flex flex-col gap-2 px-2 pt-1 pb-2">
      {pausable && (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-shell py-2 pr-2.5 pl-3">
          <span className="text-[13px] font-medium">Run on schedule</span>
          <Switch checked={routine.enabled} onChange={onToggle} label={`${routine.title} enabled`} />
        </div>
      )}
      {confirming ? (
        <DeleteConfirm title={routine.title} triggerCount={triggerCount} onDelete={onDelete} onCancel={() => setConfirming(false)} />
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button type="button" size="sm" variant="ghost" onClick={onEdit} className={GHOST}>Edit</Button>
          <Button type="button" size="sm" variant="ghost" aria-expanded={historyOpen} onClick={onToggleHistory} className={GHOST}>History</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)} className={GHOST}>Delete</Button>
        </div>
      )}
      {historyOpen && <RunHistory bot={routine.bot} routineId={routine.id} timezone={routine.timezone} instruction={routine.instruction} refreshKey={runTick} />}
      {triggers && <TriggerSection bot={routine.bot} routine={routine} triggers={triggers} sandboxed={sandboxed} onChanged={onChanged} />}
    </div>
  )
}
