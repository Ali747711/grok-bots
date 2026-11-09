import { useState } from 'react'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

import { CrewApiError, createRoutine, updateRoutine } from './routines-api'
import { SchedulePicker, scheduleReady } from './SchedulePicker'
import type { RoutineInput, RoutineView, ScheduleSpec } from './types'
import { formatInZone, useSchedulePreview } from './use-schedule-preview'

interface RoutineFormProps {
  bot: string
  /** Present when editing. */
  initial?: RoutineView
  onSaved: () => void
  onCancel: () => void
}

// Native select for the long zone list (type-ahead): styled like the shadcn trigger, with dark counterparts for its dark: classes.
const SELECT = 'h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30'
const FIELD = 'flex flex-col gap-1.5'
const LABEL = 'text-sm font-medium'
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const RUNS_HINT = 'Runs only when one of its triggers gets an event. Add triggers after saving.'
const DEFAULT_SCHEDULE: ScheduleSpec = { kind: 'daily', time: '09:00' }

function saveError(e: unknown): string {
  if (e instanceof CrewApiError && e.body?.error === 'bad_body') return "Some fields aren't filled in correctly."
  if (e instanceof CrewApiError && typeof e.body?.message === 'string') return e.body.message
  return e instanceof CrewApiError && e.status === 503 ? 'Hermes is offline' : 'Could not save the routine. Try again.'
}

type Runs = 'schedule' | 'triggered'

/** "Runs" radio pair: native radios like the group-routing rule in ReplyRule. */
function RunsChoice({ runs, onChange }: { runs: Runs; onChange: (runs: Runs) => void }) {
  const options: { value: Runs; label: string }[] = [{ value: 'schedule', label: 'On a schedule' }, { value: 'triggered', label: 'Only when triggered' }]
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
      <legend className="mb-1 text-sm font-medium">Runs</legend>
      <div role="radiogroup" aria-label="Runs" className="flex flex-col gap-1.5">
        {options.map(o => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="routine-runs" value={o.value} checked={runs === o.value} onChange={() => onChange(o.value)} className="accent-foreground" />
            <span>{o.label}</span>
          </label>
        ))}
      </div>
      {runs === 'triggered' && <p className="text-xs text-muted-foreground">{RUNS_HINT}</p>}
    </fieldset>
  )
}

function NextRuns({ schedule, timezone }: { schedule: ScheduleSpec; timezone: string }) {
  const { next, error } = useSchedulePreview(schedule, timezone, scheduleReady(schedule))
  return (
    <div className="flex flex-col gap-1 rounded-xl bg-muted p-3">
      <div className="label-mono">Next runs</div>
      {error && <p className="text-xs text-muted-foreground">{error}</p>}
      {next?.map(ms => <p key={ms} className="font-mono text-xs">{formatInZone(ms, timezone)}</p>)}
    </div>
  )
}

/** True only when the user changed the zone select or the schedule; otherwise the server keeps the stored zone (even none). */
const zoneOrScheduleChanged = (initial: RoutineView, seed: ScheduleSpec, schedule: ScheduleSpec, timezone: string): boolean =>
  timezone !== (initial.timezone ?? browserZone()) || JSON.stringify(schedule) !== JSON.stringify(seed)

/** A trigger-only routine stores Hermes's yearly placeholder; never offer that as a schedule. */
const seedSchedule = (initial?: RoutineView): ScheduleSpec => (initial && !initial.triggerOnly ? initial.schedule : DEFAULT_SCHEDULE)

function useRoutineDraft({ bot, initial, onSaved }: Omit<RoutineFormProps, 'onCancel'>) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [instruction, setInstruction] = useState(initial?.instruction ?? '')
  const [schedule, setSchedule] = useState<ScheduleSpec>(seedSchedule(initial))
  const [timezone, setTimezone] = useState(initial?.timezone ?? browserZone())
  const [runs, setRuns] = useState<Runs>(initial?.triggerOnly ? 'triggered' : 'schedule')
  const [deliverToChat, setDeliverToChat] = useState(initial?.deliverToChat ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const input: RoutineInput = { title: title.trim(), instruction: instruction.trim(), schedule, timezone, deliverToChat, runs, ...(initial && runs === 'schedule' ? { timezoneChanged: zoneOrScheduleChanged(initial, seedSchedule(initial), schedule, timezone) } : {}) }
    setBusy(true)
    setError(null)
    try {
      await (initial ? updateRoutine(bot, initial.id, input) : createRoutine(bot, input))
      onSaved()
    } catch (e) {
      setError(saveError(e))
    } finally {
      setBusy(false)
    }
  }
  return { title, setTitle, instruction, setInstruction, schedule, setSchedule, timezone, setTimezone, deliverToChat, setDeliverToChat, runs, setRuns, busy, error, save }
}

/** Create a routine, or edit one when `initial` is given. */
export function RoutineForm({ onCancel, ...props }: RoutineFormProps) {
  const zones = Intl.supportedValuesOf('timeZone')
  const { title, setTitle, instruction, setInstruction, schedule, setSchedule, timezone, setTimezone, deliverToChat, setDeliverToChat, runs, setRuns, busy, error, save } = useRoutineDraft(props)

  const triggered = runs === 'triggered'

  // A zone saved by Hermes that this browser does not list still needs an option.
  const options = zones.includes(timezone) ? zones : [timezone, ...zones]

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className={FIELD}>
        <label htmlFor="routine-title" className={LABEL}>Title</label>
        <Input id="routine-title" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} />
      </div>
      <div className={FIELD}>
        <label htmlFor="routine-instruction" className={LABEL}>What should it do?</label>
        <Textarea id="routine-instruction" value={instruction} maxLength={4000} onChange={e => setInstruction(e.target.value)} />
      </div>
      <RunsChoice runs={runs} onChange={setRuns} />
      {!triggered && <SchedulePicker value={schedule} onChange={setSchedule} />}
      {!triggered && (
        <div className={FIELD}>
          <label htmlFor="routine-zone" className={LABEL}>Timezone</label>
          <select id="routine-zone" className={SELECT} value={timezone} onChange={e => setTimezone(e.target.value)}>
            {options.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
      )}
      <label className="flex items-start gap-2 text-sm">
        <Checkbox
          checked={deliverToChat}
          onCheckedChange={setDeliverToChat}
          className="mt-0.5 border-muted-foreground data-checked:border-foreground data-checked:bg-foreground data-checked:text-background dark:data-checked:bg-foreground"
        />
        <span>Also post the result in the chat (one extra turn per run)</span>
      </label>
      {!triggered && <NextRuns schedule={schedule} timezone={timezone} />}
      {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={busy || title.trim() === '' || instruction.trim() === '' || (!triggered && !scheduleReady(schedule))} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  )
}
