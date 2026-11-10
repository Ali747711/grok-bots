import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { RunTranscript } from '@/features/routines/RunTranscript'
import type { RoutineView } from '@/features/routines/types'
import { formatInZone } from '@/features/routines/use-schedule-preview'

import { OutcomeBadge } from './outcome-format'
import type { TriggerEvent, TriggerView } from './types'
import { useTriggerEvents } from './use-trigger-events'

interface TriggerEventsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bot: string
  trigger: TriggerView
  /** Null when the routine was deleted. */
  routine: RoutineView | null
}

function EventRow({ event, timezone, onOpenRun }: { event: TriggerEvent; timezone: string | null; onOpenRun: (runId: string) => void }) {
  return (
    <li className="flex flex-col gap-1 rounded-xl bg-muted p-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">{formatInZone(event.at, timezone)}</span>
        <span className="min-w-0 flex-1 truncate">{event.action ? `${event.eventType} · ${event.action}` : event.eventType}</span>
        <OutcomeBadge outcome={event.outcome} />
      </div>
      {event.detail && <p className="text-xs text-muted-foreground">{event.detail}</p>}
      {event.runId && (
        <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => onOpenRun(event.runId!)}>Open run</Button>
      )}
    </li>
  )
}

function EventsBody({ bot, trigger, routine }: Omit<TriggerEventsDialogProps, 'open' | 'onOpenChange'>) {
  const { events, error } = useTriggerEvents(trigger.id, true)
  const [runId, setRunId] = useState<string | null>(null)

  if (runId) {
    return (
      <div className="flex flex-col gap-2">
        <Button type="button" size="xs" variant="ghost" onClick={() => setRunId(null)} className="self-start">Back to events</Button>
        <RunTranscript bot={bot} sessionId={runId} instruction={routine?.instruction ?? ''} />
      </div>
    )
  }
  if (events === null) return <p className="text-sm text-muted-foreground">{error ? "Couldn't load the events." : 'Loading…'}</p>
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No events yet.</p>
  const newestFirst = [...events].sort((a, b) => b.at - a.at)
  return (
    <ul className="flex max-h-96 flex-col gap-1.5 overflow-y-auto">
      {newestFirst.map(e => <EventRow key={e.id} event={e} timezone={routine?.timezone ?? null} onOpenRun={setRunId} />)}
    </ul>
  )
}

/** A trigger's recent events, newest first; a run that started opens its transcript in place. */
export function TriggerEventsDialog({ open, onOpenChange, ...rest }: TriggerEventsDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{`Events · ${rest.trigger.name}`}</DialogTitle>
        </DialogHeader>
        {open && <EventsBody {...rest} />}
      </DialogContent>
    </Dialog>
  )
}
