import { useState } from 'react'

import { Button } from '@/components/ui/button'
import type { BotView } from '@/state/types'

import { RoutineForm } from './RoutineForm'
import { RoutineRow } from './RoutineRow'
import type { RoutineView } from './types'
import { useRoutines } from './use-routines'

type Editing = { kind: 'new' } | { kind: 'edit'; routine: RoutineView } | null

/** A bot's routines: list with run controls, and the create / edit form. */
export function RoutinesPanel({ bot }: { bot: BotView }) {
  const { routines, error, reload } = useRoutines(bot.name)
  const [editing, setEditing] = useState<Editing>(null)
  // One routine's history is open at a time.
  const [historyFor, setHistoryFor] = useState<string | null>(null)

  if (editing) {
    return (
      <RoutineForm
        key={editing.kind === 'edit' ? editing.routine.id : 'new'}
        bot={bot.name}
        {...(editing.kind === 'edit' ? { initial: editing.routine } : {})}
        onSaved={() => { setEditing(null); void reload() }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <Button type="button" size="sm" onClick={() => setEditing({ kind: 'new' })}>New routine</Button>
      {routines === null && <p className="text-sm text-muted-foreground">{error ? 'Could not load routines.' : 'Loading…'}</p>}
      {routines?.length === 0 && (
        <p className="text-sm text-muted-foreground">No routines yet. Routines run on a schedule and keep their results in run history.</p>
      )}
      {routines && routines.length > 0 && (
        <ul className="flex flex-col gap-2">
          {routines.map(r => <RoutineRow
              key={r.id} routine={r} onChanged={() => void reload()} onEdit={() => setEditing({ kind: 'edit', routine: r })}
              historyOpen={historyFor === r.id} onToggleHistory={() => setHistoryFor(cur => (cur === r.id ? null : r.id))}
            />)}
        </ul>
      )}
    </div>
  )
}
