import { Input } from '@/components/ui/input'

import type { ScheduleKind, ScheduleSpec, Unit } from './types'

const SELECT = 'h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const KINDS: readonly { kind: ScheduleKind; label: string }[] = [
  { kind: 'once_in', label: 'Once, after…' },
  { kind: 'once_at', label: 'Once, at…' },
  { kind: 'every', label: 'Every…' },
  { kind: 'daily', label: 'Every day' },
  { kind: 'weekdays', label: 'Weekdays' },
  { kind: 'weekly', label: 'Every week' },
  { kind: 'monthly', label: 'Every month' },
  { kind: 'cron', label: 'Custom (cron)' }
]

interface PickerProps {
  value: ScheduleSpec
  onChange: (next: ScheduleSpec) => void
}

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.trunc(n) || min))
const timeOf = (v: ScheduleSpec) => ('time' in v ? v.time : '09:00')

/** A schedule of another kind, carrying over what still makes sense (the time of day). */
export function defaultFor(kind: ScheduleKind, from: ScheduleSpec): ScheduleSpec {
  const time = timeOf(from)
  switch (kind) {
    case 'once_in': return { kind, amount: 30, unit: 'm' }
    case 'once_at': return { kind, at: '' }
    case 'every': return { kind, amount: 1, unit: 'h' }
    case 'daily': case 'weekdays': return { kind, time }
    case 'weekly': return { kind, day: 1, time }
    case 'monthly': return { kind, day: 1, time }
    case 'cron': return { kind, expr: '' }
  }
}

function AmountUnit({ value, onChange }: { value: Extract<ScheduleSpec, { amount: number }>; onChange: (n: ScheduleSpec) => void }) {
  return (
    <div className="flex gap-2">
      <Input aria-label="Amount" type="number" min={1} max={999} className="w-24" value={value.amount} onChange={e => onChange({ ...value, amount: clamp(Number(e.target.value), 1, 999) })} />
      <select aria-label="Unit" className={SELECT} value={value.unit} onChange={e => onChange({ ...value, unit: e.target.value as Unit })}>
        <option value="m">minutes</option>
        <option value="h">hours</option>
        <option value="d">days</option>
      </select>
    </div>
  )
}

function TimeInput({ value, onChange }: { value: Extract<ScheduleSpec, { time: string }>; onChange: (n: ScheduleSpec) => void }) {
  return <Input aria-label="Time" type="time" className="w-32" value={value.time} onChange={e => e.target.value && onChange({ ...value, time: e.target.value })} />
}

function Details({ value, onChange }: PickerProps) {
  switch (value.kind) {
    case 'once_in': case 'every':
      return <AmountUnit value={value} onChange={onChange} />
    case 'once_at':
      return <Input aria-label="Date and time" type="datetime-local" value={value.at} onChange={e => onChange({ ...value, at: e.target.value })} />
    case 'daily': case 'weekdays':
      return <TimeInput value={value} onChange={onChange} />
    case 'weekly':
      return (
        <div className="flex gap-2">
          <select aria-label="Day of the week" className={SELECT} value={value.day} onChange={e => onChange({ ...value, day: Number(e.target.value) })}>
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <TimeInput value={value} onChange={onChange} />
        </div>
      )
    case 'monthly':
      return (
        <div className="flex gap-2">
          <Input aria-label="Day of the month" type="number" min={1} max={31} className="w-24" value={value.day} onChange={e => onChange({ ...value, day: clamp(Number(e.target.value), 1, 31) })} />
          <TimeInput value={value} onChange={onChange} />
        </div>
      )
    case 'cron':
      return <Input aria-label="Cron expression" value={value.expr} placeholder="*/15 * * * *" onChange={e => onChange({ ...value, expr: e.target.value })} />
  }
}

/** Pick when a routine runs; emits a `ScheduleSpec`. */
export function SchedulePicker({ value, onChange }: PickerProps) {
  return (
    <div className="flex flex-col gap-2">
      <select aria-label="Repeat" className={SELECT} value={value.kind} onChange={e => onChange(defaultFor(e.target.value as ScheduleKind, value))}>
        {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      <Details value={value} onChange={onChange} />
    </div>
  )
}
