import { Plus, Zap } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { GHOST } from '@/features/routines/row-styles'
import type { RoutineView } from '@/features/routines/types'

import { AddTriggerDialog } from './AddTriggerDialog'
import { TriggerItem } from './TriggerItem'
import type { TriggerView } from './types'

interface TriggerSectionProps {
  bot: string
  routine: RoutineView
  triggers: readonly TriggerView[]
  sandboxed: boolean
  onChanged: () => void
}

/** The triggers of one routine, behind a "Triggers (n)" disclosure, with Add trigger. */
export function TriggerSection({ bot, routine, triggers, sandboxed, onChanged }: TriggerSectionProps) {
  const [open, setOpen] = useState(false)
  const [adding, setAdding] = useState(false)

  return (
    <div className="flex flex-col gap-1.5">
      <Button type="button" size="sm" variant="ghost" aria-expanded={open} onClick={() => setOpen(o => !o)} className={`self-start ${GHOST}`}>
        <Zap aria-hidden="true" className="text-muted-foreground" />
        {`Triggers (${triggers.length})`}
      </Button>
      {open && (
        <>
          {triggers.length === 0 ? (
            <p className="px-1 text-xs font-medium text-muted-foreground">No triggers yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {triggers.map(t => <li key={t.id}><TriggerItem trigger={t} routine={routine} onChanged={onChanged} /></li>)}
            </ul>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(true)} className={`self-start ${GHOST}`}><Plus aria-hidden="true" />Add trigger</Button>
        </>
      )}
      <AddTriggerDialog open={adding} onOpenChange={setAdding} bot={bot} routine={routine} sandboxed={sandboxed} onCreated={onChanged} />
    </div>
  )
}
