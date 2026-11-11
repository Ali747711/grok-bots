import { useState } from 'react'

import { FIELD, FIELD_LABEL, HINT } from '@/components/console/dialog-styles'
import { RadioRows } from '@/components/console/radio-rows'
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

// Native select for the long zone list (type-ahead): styled like the luma Input.
const SELECT = 'h-9 w-full rounded-3xl border border-transparent bg-input/50 px-3 text-sm outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring'
const LABEL = FIELD_LABEL
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const RUNS_HINT = 'Runs only when one of its triggers gets an event. Add triggers after saving.'
const DEFAULT_SCHEDULE: ScheduleSpec = { kind: 'daily', time: '09:00' }

function saveError(e: unknown): string {
  if (e instanceof CrewApiError && e.body?.error === 'bad_body') return "Some fields aren't filled in correctly."
  if (e instanceof CrewApiError && typeof e.body?.message === 'string') return e.body.message
  return e instanceof CrewApiError && e.status === 503 ? 'Hermes is offline' : 'Could not save the routine. Try again.'
}

type Runs = 'schedule' | 'triggered'
const RUNS: readonly { value: Runs; label: string }[] = [{ value: 'schedule', label: 'On a schedule' }, { value: 'triggered', label: 'Only when triggered' }]

function NextRuns({ schedule, timezone }: { schedule: ScheduleSpec; timezone: string }) {
  const { next, error } = useSchedulePreview(schedule, timezone, scheduleReady(schedule))
  return (
    <div className="flex flex-col gap-1 rounded-2xl bg-background px-3.5 py-3">
      <div className="text-xs font-medium text-muted-foreground">Next runs</div>
      {error && <p className="text-xs font-medium text-muted-foreground">{error}</p>}
      {next?.map(ms => <p key={ms} className="font-mono text-xs tabular-nums">{formatInZone(ms, timezone)}</p>)}
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
    const input: RoutineInput = { title: title.trim(), instruction: instruction.trim(), schedule, timezone, deliverToChat, runs, ...(initial && runs === 'schedule' ? { timezoneChanged: initial.triggerOnly || zoneOrScheduleChanged(initial, seedSchedule(initial), schedule, timezone) } : {}) }
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
    <div className="flex flex-col gap-4 px-3 pt-1 pb-3">
      <div className={FIELD}>
        <label htmlFor="routine-title" className={LABEL}>Title</label>
        <Input id="routine-title" value={title} maxLength={80} onChange={e => setTitle(e.target.value)} />
      </div>
      <div className={FIELD}>
        <label htmlFor="routine-instruction" className={LABEL}>What should it do?</label>
        <Textarea id="routine-instruction" value={instruction} maxLength={4000} onChange={e => setInstruction(e.target.value)} />
      </div>
      <RadioRows legend="Runs" value={runs} options={RUNS} onChange={setRuns}>
        {triggered && <p className={HINT}>{RUNS_HINT}</p>}
      </RadioRows>
      {!triggered && <SchedulePicker value={schedule} onChange={setSchedule} />}
      {!triggered && (
        <div className={FIELD}>
          <label htmlFor="routine-zone" className={LABEL}>Timezone</label>
          <select id="routine-zone" className={SELECT} value={timezone} onChange={e => setTimezone(e.target.value)}>
            {options.map(z => <option key={z} value={z}>{z}</option>)}
          </select>
        </div>
      )}
      <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl bg-background px-3.5 py-3 text-[13px] font-medium has-focus-visible:ring-3 has-focus-visible:ring-ring">
        <Checkbox checked={deliverToChat} onCheckedChange={setDeliverToChat} className="mt-0.5 border-ring bg-shell focus-visible:ring-0" />
        <span>Also post the result in the chat (one extra turn per run)</span>
      </label>
      {!triggered && <NextRuns schedule={schedule} timezone={timezone} />}
      {error && <Alert variant="destructive" className="rounded-2xl border-0 bg-background px-3.5 py-3"><AlertDescription className="text-xs font-medium">{error}</AlertDescription></Alert>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={busy || title.trim() === '' || instruction.trim() === '' || (!triggered && !scheduleReady(schedule))} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  )
}
