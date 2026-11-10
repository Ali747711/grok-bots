import { ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useId, useState } from 'react'

import { IconButton } from '@/components/console/icon-button'
import { Button } from '@/components/ui/button'
import type { TriggerView } from '@/features/triggers/types'
import { settle, snappy } from '@/lib/motion'
import { cn } from '@/lib/utils'

import { describeSchedule } from './describe-schedule'
import { RoutineDetails } from './RoutineDetails'
import { type PillTone, StatusPill } from './StatusPill'
import type { LastStatus, RoutineView } from './types'
import { useRowActions } from './use-row-actions'
import { formatInZone } from './use-schedule-preview'

const RESULT: Record<LastStatus, { text: string; tone: PillTone }> = {
  ok: { text: 'OK', tone: 'ok' },
  error: { text: 'Error', tone: 'error' },
  delivery_failed: { text: 'Delivery failed', tone: 'error' },
  blocked_config: { text: 'Config problem', tone: 'warn' }
}

/**
 * The split accordion (crew-bots `card-split-accordian`), in CSS: closed rows sit together as one
 * rounded block; an open row steps away from its neighbours, and the rows around it round the
 * corners that now face the gap.
 */
const ROW = cn(
  'overflow-hidden rounded-md bg-background text-sm first:rounded-t-2xl last:rounded-b-2xl',
  'motion-safe:transition-[margin,border-radius] motion-safe:duration-300',
  'data-[open=true]:my-1.5 data-[open=true]:rounded-2xl first:data-[open=true]:mt-0 last:data-[open=true]:mb-0',
  'has-[+[data-open=true]]:rounded-b-2xl [[data-open=true]+&]:rounded-t-2xl'
)

interface RoutineRowProps {
  routine: RoutineView
  onChanged: () => void
  onEdit: () => void
  historyOpen: boolean
  onToggleHistory: () => void
  /** How many triggers fire this routine; used in the delete warning. */
  triggerCount?: number
  /** This routine's triggers, listed in a disclosure inside the open row. */
  triggers?: readonly TriggerView[]
  /** The bot runs in a sandbox; the Add trigger tip is for bots that don't. */
  sandboxed?: boolean
}

function statusText(routine: RoutineView): string {
  if (routine.triggerOnly) return 'Only when triggered'
  // Hermes has finished it: nothing left to pause, resume or run.
  if (routine.finished) return 'Done'
  if (!routine.enabled) return 'Paused'
  return routine.nextRunAt !== null ? `Next · ${formatInZone(routine.nextRunAt, routine.timezone)}` : ''
}

/** Next run, "Paused", "Done" or "Only when triggered", then the last result. */
function StatusLine({ routine }: { routine: RoutineView }) {
  const result = routine.lastStatus ? RESULT[routine.lastStatus] : null
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-xs font-medium text-muted-foreground">{statusText(routine)}</span>
      {routine.finished && routine.lastRunAt !== null && <span className="text-xs font-medium text-muted-foreground">{formatInZone(routine.lastRunAt, routine.timezone)}</span>}
      {result && <StatusPill tone={result.tone} title={routine.lastError ?? undefined}>{result.text}</StatusPill>}
    </div>
  )
}

/**
 * One routine as an accordion row. Always in view: its name, schedule, next run, last result and
 * Run now. Opened with "Routine details": the pause switch, Edit, History, Delete and its triggers.
 */
export function RoutineRow({ routine, onChanged, onEdit, historyOpen, onToggleHistory, triggerCount = 0, triggers, sandboxed = false }: RoutineRowProps) {
  const [open, setOpen] = useState(false)
  const detailsId = useId()
  const { note, runTick, run, toggle, remove } = useRowActions(routine, onChanged)

  return (
    <li data-open={open} className={ROW}>
      <div className="flex items-start gap-1.5 pt-3 pr-2 pb-2 pl-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="truncate text-[13px] font-semibold">{routine.title}</span>
          {!routine.triggerOnly && <span className="text-xs font-medium text-muted-foreground">{describeSchedule(routine.schedule)}</span>}
          <StatusLine routine={routine} />
          {note && <p role="status" className="text-xs font-medium text-muted-foreground">{note}</p>}
        </div>
        {!routine.finished && (
          <Button type="button" size="sm" variant="outline" disabled={routine.running} onClick={() => void run()}>{routine.running ? 'Running…' : 'Run now'}</Button>
        )}
        <IconButton label="Routine details" aria-expanded={open} aria-controls={open ? detailsId : undefined} onClick={() => setOpen(o => !o)}>
          <motion.span initial={false} animate={{ rotate: open ? 180 : 0 }} transition={snappy} className="flex">
            <ChevronDown aria-hidden="true" />
          </motion.span>
        </IconButton>
      </div>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="details" id={detailsId} role="group" aria-label={`${routine.title} details`} className="overflow-hidden"
            initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={settle}
          >
            <RoutineDetails
              routine={routine} onChanged={onChanged} onEdit={onEdit} onToggle={() => void toggle()} onDelete={() => void remove()}
              historyOpen={historyOpen} onToggleHistory={onToggleHistory} runTick={runTick}
              triggerCount={triggerCount} triggers={triggers} sandboxed={sandboxed}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}
