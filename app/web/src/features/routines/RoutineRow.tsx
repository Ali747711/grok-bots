import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { describeSchedule } from './describe-schedule'
import { RunHistory } from './RunHistory'
import { CrewApiError, deleteRoutine, pauseRoutine, resumeRoutine, runRoutine } from './routines-api'
import type { LastStatus, RoutineView } from './types'
import { formatInZone } from './use-schedule-preview'

const RESULT: Record<LastStatus, { text: string; bad: boolean }> = {
  ok: { text: 'OK', bad: false },
  error: { text: 'Error', bad: true },
  delivery_failed: { text: 'Delivery failed', bad: true },
  blocked_config: { text: 'Config problem', bad: true }
}

interface RoutineRowProps {
  routine: RoutineView
  onChanged: () => void
  onEdit: () => void
  historyOpen: boolean
  onToggleHistory: () => void
}

/** Every action ends with a re-read; a failure shows as a note on the row. */
function useRowActions(routine: RoutineView, onChanged: () => void) {
  const [note, setNote] = useState<string | null>(null)
  // Bumped after Run now so an open history re-reads at once.
  const [runTick, setRunTick] = useState(0)
  const act = async (action: () => Promise<unknown>, fail: string) => {
    setNote(null)
    try {
      await action()
    } catch (e) {
      // The server's own reason (a Hermes refusal) beats a generic line.
      setNote(e instanceof CrewApiError && typeof e.body?.message === 'string' ? e.body.message : fail)
    }
    onChanged()
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
    remove: () => act(() => deleteRoutine(routine.bot, routine.id), 'Could not delete the routine')
  }
}

function PauseSwitch({ routine, onToggle }: { routine: RoutineView; onToggle: () => void }) {
  return (
    <button
      type="button" role="switch" aria-checked={routine.enabled} aria-label={`${routine.title} enabled`} onClick={onToggle}
      className={cn('h-5 w-9 rounded-full border border-border p-0.5 transition-colors', routine.enabled ? 'bg-foreground' : 'bg-secondary')}
    >
      <span className={cn('block size-3.5 rounded-full bg-background transition-transform', routine.enabled ? 'translate-x-4' : 'bg-muted-foreground')} />
    </button>
  )
}

/** Next run, "Paused", or "Done" for a routine Hermes has finished (nothing left to pause, resume or run). */
function StatusLine({ routine }: { routine: RoutineView }) {
  const result = routine.lastStatus ? RESULT[routine.lastStatus] : null
  const text = routine.finished ? 'Done' : routine.enabled ? (routine.nextRunAt !== null ? `Next: ${formatInZone(routine.nextRunAt, routine.timezone)}` : '') : 'Paused'
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>{text}</span>
      {routine.finished && routine.lastRunAt !== null && <span>{formatInZone(routine.lastRunAt, routine.timezone)}</span>}
      {result && <span title={routine.lastError ?? undefined} className={cn('rounded-full bg-secondary px-1.5', result.bad && 'text-destructive')}>{result.text}</span>}
    </div>
  )
}

/** One routine: schedule, next run, last result, pause switch, Run now, Edit, Delete (with confirmation). */
export function RoutineRow({ routine, onChanged, onEdit, historyOpen, onToggleHistory }: RoutineRowProps) {
  const [confirming, setConfirming] = useState(false)
  const { note, runTick, run, toggle, remove } = useRowActions(routine, onChanged)

  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-border p-3 text-sm">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-medium">{routine.title}</span>
        {!routine.finished && <PauseSwitch routine={routine} onToggle={() => void toggle()} />}
      </div>
      <div className="text-xs text-muted-foreground">{describeSchedule(routine.schedule)}</div>
      <StatusLine routine={routine} />
      {note && <p role="status" className="text-xs text-muted-foreground">{note}</p>}
      {confirming ? (
        <div className="flex items-center gap-2">
          <span>{`Delete “${routine.title}”?`}</span>
          <Button type="button" size="sm" variant="destructive" onClick={() => void remove()}>Yes, delete</Button>
          <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          {!routine.finished && (
            <Button type="button" size="sm" variant="outline" disabled={routine.running} onClick={() => void run()}>{routine.running ? 'Running…' : 'Run now'}</Button>
          )}
          <Button type="button" size="sm" variant="ghost" aria-expanded={historyOpen} onClick={onToggleHistory}>History</Button>
          <Button type="button" size="sm" variant="ghost" onClick={onEdit}>Edit</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(true)}>Delete</Button>
        </div>
      )}
      {historyOpen && <RunHistory bot={routine.bot} routineId={routine.id} timezone={routine.timezone} instruction={routine.instruction} refreshKey={runTick} />}
    </li>
  )
}
