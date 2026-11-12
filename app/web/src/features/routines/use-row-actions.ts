import { useState } from 'react'
import { toast } from 'sonner'

import { CrewApiError, deleteRoutine, pauseRoutine, resumeRoutine, runRoutine } from './routines-api'
import type { RoutineView } from './types'

/** A routine row's actions. Every one ends with a re-read; a failure shows as a note on the row. */
export function useRowActions(routine: RoutineView, onChanged: () => void) {
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
