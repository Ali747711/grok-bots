import { useState } from 'react'

import { Button } from '@/components/ui/button'
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

const SELECT = 'h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
const FIELD = 'flex flex-col gap-1.5'
const LABEL = 'text-sm font-medium'
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone
const DEFAULT_SCHEDULE: ScheduleSpec = { kind: 'daily', time: '09:00' }

function saveError(e: unknown): string {
  if (e instanceof CrewApiError && e.body?.error === 'bad_body') return "Some fields aren't filled in correctly."
  if (e instanceof CrewApiError && typeof e.body?.message === 'string') return e.body.message
  return e instanceof CrewApiError && e.status === 503 ? 'Hermes is offline' : 'Could not save the routine. Try again.'
}

function NextRuns({ schedule, timezone }: { schedule: ScheduleSpec; timezone: string }) {
  const { next, error } = useSchedulePreview(schedule, timezone, scheduleReady(schedule))
  return (
    <div className="text-xs text-muted-foreground">
      <div className="font-medium">Next runs</div>
      {error && <p>{error}</p>}
      {next?.map(ms => <p key={ms}>{formatInZone(ms, timezone)}</p>)}
    </div>
  )
}

/** True only when the user changed the zone select or the schedule; otherwise the server keeps the stored zone (even none). */
const zoneOrScheduleChanged = (initial: RoutineView, schedule: ScheduleSpec, timezone: string): boolean =>
  timezone !== (initial.timezone ?? browserZone()) || JSON.stringify(schedule) !== JSON.stringify(initial.schedule)

function useRoutineDraft({ bot, initial, onSaved }: Omit<RoutineFormProps, 'onCancel'>) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [instruction, setInstruction] = useState(initial?.instruction ?? '')
  const [schedule, setSchedule] = useState<ScheduleSpec>(initial?.schedule ?? DEFAULT_SCHEDULE)
  const [timezone, setTimezone] = useState(initial?.timezone ?? browserZone())
  const [deliverToChat, setDeliverToChat] = useState(initial?.deliverToChat ?? false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const input: RoutineInput = { title: title.trim(), instruction: instruction.trim(), schedule, timezone, deliverToChat, ...(initial ? { timezoneChanged: zoneOrScheduleChanged(initial, schedule, timezone) } : {}) }
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
  return { title, setTitle, instruction, setInstruction, schedule, setSchedule, timezone, setTimezone, deliverToChat, setDeliverToChat, busy, error, save }
}

/** Create a routine, or edit one when `initial` is given. */
export function RoutineForm({ onCancel, ...props }: RoutineFormProps) {
  const zones = Intl.supportedValuesOf('timeZone')
  const { title, setTitle, instruction, setInstruction, schedule, setSchedule, timezone, setTimezone, deliverToChat, setDeliverToChat, busy, error, save } = useRoutineDraft(props)

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
      <SchedulePicker value={schedule} onChange={setSchedule} />
      <div className={FIELD}>
        <label htmlFor="routine-zone" className={LABEL}>Timezone</label>
        <select id="routine-zone" className={SELECT} value={timezone} onChange={e => setTimezone(e.target.value)}>
          {options.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={deliverToChat} onChange={e => setDeliverToChat(e.target.checked)} />
        <span>Also post the result in the chat (one extra turn per run)</span>
      </label>
      <NextRuns schedule={schedule} timezone={timezone} />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
        <Button type="button" disabled={busy || title.trim() === '' || instruction.trim() === '' || !scheduleReady(schedule)} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  )
}
