import { useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

import { TriggerSection } from '@/features/triggers/TriggerSection'
import type { TriggerView } from '@/features/triggers/types'

import { describeSchedule } from './describe-schedule'
import { GHOST, SWITCH } from './row-styles'
import { RunHistory } from './RunHistory'
import { CrewApiError, deleteRoutine, pauseRoutine, resumeRoutine, runRoutine } from './routines-api'
import type { LastStatus, RoutineView } from './types'
import { formatInZone } from './use-schedule-preview'

const RESULT: Record<LastStatus, { text: string; tone: string }> = {
  ok: { text: 'OK', tone: 'bg-status-working/15 text-foreground' },
  error: { text: 'Error', tone: 'bg-destructive/10 text-destructive' },
  delivery_failed: { text: 'Delivery failed', tone: 'bg-destructive/10 text-destructive' },
  blocked_config: { text: 'Config problem', tone: 'bg-status-waiting/15 text-foreground' }
}

export { GHOST }

interface RoutineRowProps {
  routine: RoutineView
  onChanged: () => void
  onEdit: () => void
  historyOpen: boolean
  onToggleHistory: () => void
  /** How many triggers fire this routine (Task 8 passes it); used in the delete warning. */
  triggerCount?: number
  /** This routine's triggers, listed in a disclosure under the row. */
  triggers?: readonly TriggerView[]
  /** The bot runs in a sandbox; the Add trigger tip is for bots that don't. */
  sandboxed?: boolean
}

/** Every action ends with a re-read; a failure shows as a note on the row. */
function useRowActions(routine: RoutineView, onChanged: () => void) {
  const [note, setNote] = useState<string | null>(null)
  // Bumped after Run now so an open history re-reads at once.
  const [runTick, setRunTick] = useState(0)
  const act = async (action: () => Promise<unknown>, fail: string): Promise<boolean> => {
    setNote(null)
    let ok = true
    try {
      await action()
    } catch (e) {
      ok = false
      // The server's own reason (a Hermes refusal) beats a generic line.
      setNote(e instanceof CrewApiError && typeof e.body?.message === 'string' ? e.body.message : fail)
    }
    onChanged()
    return ok
  }
  return {
    note,
    runTick,
    run: () =>
      act(async () => {
        const answer = await runRoutine(routine.bot, routine.id)
        if (answer.status === 'already_running') setNote('Already running')
        if (answer.status === 'finished') setNote(answer.message ?? 'This routine has finished.')
        setRunTick(t => t + 1)
      }, 'Could not start the routine'),
    toggle: () => act(() => (routine.enabled ? pauseRoutine : resumeRoutine)(routine.bot, routine.id), 'Could not change the routine'),
    remove: async () => {
      if (await act(() => deleteRoutine(routine.bot, routine.id), 'Could not delete the routine')) toast.success('Routine deleted')
    }
  }
}

function PauseSwitch({ routine, onToggle }: { routine: RoutineView; onToggle: () => void }) {
  return (
    <Switch
      checked={routine.enabled}
      onCheckedChange={onToggle}
      aria-label={`${routine.title} enabled`}
      className={SWITCH}
    />
  )
}

/** Next run, "Paused", or "Done" for a routine Hermes has finished (nothing left to pause, resume or run). */
function StatusLine({ routine }: { routine: RoutineView }) {
  const result = routine.lastStatus ? RESULT[routine.lastStatus] : null
  const text = routine.triggerOnly ? 'Only when triggered' : routine.finished ? 'Done' : routine.enabled ? (routine.nextRunAt !== null ? `Next · ${formatInZone(routine.nextRunAt, routine.timezone)}` : '') : 'Paused'
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-medium text-muted-foreground">{text}</span>
      {routine.finished && routine.lastRunAt !== null && <span className="text-xs font-medium text-muted-foreground">{formatInZone(routine.lastRunAt, routine.timezone)}</span>}
      {result && <Badge title={routine.lastError ?? undefined} className={cn('h-5 px-2 text-xs ring-1 ring-border', result.tone)}>{result.text}</Badge>}
    </div>
  )
}

/** One routine: schedule, next run, last result, pause switch, Run now, Edit, Delete (with confirmation). */
export function RoutineRow({ routine, onChanged, onEdit, historyOpen, onToggleHistory, triggerCount = 0, triggers, sandboxed = false }: RoutineRowProps) {
  const [confirming, setConfirming] = useState(false)
  const { note, runTick, run, toggle, remove } = useRowActions(routine, onChanged)

  return (
    <li className="flex flex-col gap-2 rounded-2xl bg-muted p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-semibold">{routine.title}</span>
        {!routine.finished && !routine.triggerOnly && <PauseSwitch routine={routine} onToggle={() => void toggle()} />}
      </div>
      {!routine.triggerOnly && <div className="text-xs text-muted-foreground">{describeSchedule(routine.schedule)}</div>}
      <StatusLine routine={routine} />
      {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
      {confirming ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span>{`Delete “${routine.title}”?`}</span>
            <Button type="button" size="sm" variant="destructive" onClick={() => void remove()}>Yes, delete</Button>
            <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
          {triggerCount > 0 && <p className="text-xs text-muted-foreground">{triggerCount === 1 ? 'This routine has 1 trigger; it will stop working.' : `This routine has ${triggerCount} triggers; they will stop working.`}</p>}
        </div>
      ) : (
        <div className="flex gap-1.5">
          {!routine.finished && (
            <Button type="button" size="sm" variant="outline" disabled={routine.running} onClick={() => void run()}>{routine.running ? 'Running…' : 'Run now'}</Button>
          )}
          <Button type="button" size="sm" variant="ghost" aria-expanded={historyOpen} onClick={onToggleHistory} className={GHOST}>History</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onEdit} className={GHOST}>Edit</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)} className={GHOST}>Delete</Button>
        </div>
      )}
      {triggers && <TriggerSection bot={routine.bot} routine={routine} triggers={triggers} sandboxed={sandboxed} onChanged={onChanged} />}
      {historyOpen && <RunHistory bot={routine.bot} routineId={routine.id} timezone={routine.timezone} instruction={routine.instruction} refreshKey={runTick} />}
    </li>
  )
}
