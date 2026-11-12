import { Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import type { BotView } from '@/state/types'

import { OrphanTriggers } from '@/features/triggers/OrphanTriggers'
import { triggerErrorText } from '@/features/triggers/triggers-api'
import { useTriggers } from '@/features/triggers/use-triggers'

import { RoutineForm } from './RoutineForm'
import { RoutineRow } from './RoutineRow'
import type { RoutineView } from './types'
import { useRoutines } from './use-routines'

const NOTE = 'px-3 text-xs font-medium text-muted-foreground'

type Editing = { kind: 'new' } | { kind: 'edit'; routine: RoutineView } | null

/** A bot's routines: list with run controls, and the create / edit form. */
export function RoutinesPanel({ bot }: { bot: BotView }) {
  const { routines, error, reload } = useRoutines(bot.name)
  const { triggers, error: triggersError, reload: reloadTriggers } = useTriggers(bot.name)
  const [editing, setEditing] = useState<Editing>(null)
  // One routine's history is open at a time.
  const [historyFor, setHistoryFor] = useState<string | null>(null)

  const changed = () => { void reload(); void reloadTriggers() }
  const of = (id: string) => triggers?.filter(t => t.routineId === id)
  const orphans = routines && triggers ? triggers.filter(t => !routines.some(r => r.id === t.routineId)) : []

  if (editing) {
    return (
      <RoutineForm
        key={editing.kind === 'edit' ? editing.routine.id : 'new'}
        bot={bot.name}
        {...(editing.kind === 'edit' ? { initial: editing.routine } : {})}
        onSaved={() => { setEditing(null); void reload(); toast.success('Routine saved') }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <div className="flex flex-col gap-2 px-2 pb-2">
      <div className="flex items-center justify-between gap-2 py-1 pr-1 pl-3">
        <h2 className="text-[13px] font-semibold">{`${bot.title}'s routines`}</h2>
        <Button type="button" size="sm" onClick={() => setEditing({ kind: 'new' })}><Plus aria-hidden="true" />New routine</Button>
      </div>
      {triggers === null && triggersError !== null && <p role="status" className={NOTE}>{triggerErrorText(triggersError)}</p>}
      {routines === null && <p className={NOTE}>{error ? 'Could not load routines.' : 'Loading…'}</p>}
      {routines?.length === 0 && (
        <p className="rounded-2xl bg-background px-4 py-6 text-center text-[13px] font-medium text-muted-foreground">No routines yet. Routines run on a schedule and keep their results in run history.</p>
      )}
      {routines && routines.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {routines.map(r => <RoutineRow
              key={r.id} routine={r} onChanged={changed} onEdit={() => setEditing({ kind: 'edit', routine: r })}
              sandboxed={bot.sandbox === 'on'} triggers={of(r.id)} triggerCount={of(r.id)?.length ?? 0}
              historyOpen={historyFor === r.id} onToggleHistory={() => setHistoryFor(cur => (cur === r.id ? null : r.id))}
            />)}
        </ul>
      )}
      <OrphanTriggers bot={bot.name} triggers={orphans} onChanged={changed} />
    </div>
  )
}
