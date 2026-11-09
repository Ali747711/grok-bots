import { useEffect, useId, useState } from 'react'

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

/** False while a one-time date or a cron expression is still empty; the form holds Save and the preview until then. */
export function scheduleReady(spec: ScheduleSpec): boolean {
  if (spec.kind === 'once_at') return spec.at !== ''
  if (spec.kind === 'cron') return spec.expr.trim() !== ''
  return true
}

interface NumberFieldProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (n: number) => void
}

/** Keeps what is typed as text (so it can be cleared and retyped); the clamped number goes up, the text is tidied on blur. */
function NumberField({ label, value, min, max, onChange }: NumberFieldProps) {
  const [raw, setRaw] = useState(String(value))
  useEffect(() => {
    // Follow outside changes (a different kind picked), but never fight a field the user has emptied.
    setRaw(r => (r === '' || clamp(Number(r), min, max) === value ? r : String(value)))
  }, [value, min, max])

  return (
    <Input
      aria-label={label} type="number" min={min} max={max} className="w-24" value={raw}
      onChange={e => {
        setRaw(e.target.value)
        if (e.target.value !== '') onChange(clamp(Number(e.target.value), min, max))
      }}
      onBlur={() => setRaw(String(value))}
    />
  )
}
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
      <NumberField label="Amount" value={value.amount} min={1} max={999} onChange={amount => onChange({ ...value, amount })} />
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
          <NumberField label="Day of the month" value={value.day} min={1} max={31} onChange={day => onChange({ ...value, day })} />
          <TimeInput value={value} onChange={onChange} />
        </div>
      )
    case 'cron':
      return <Input aria-label="Cron expression" value={value.expr} placeholder="*/15 * * * *" onChange={e => onChange({ ...value, expr: e.target.value })} />
  }
}

/** Pick when a routine runs; emits a `ScheduleSpec`. */
export function SchedulePicker({ value, onChange }: PickerProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium">When</label>
      <select id={id} className={SELECT} value={value.kind} onChange={e => onChange(defaultFor(e.target.value as ScheduleKind, value))}>
        {KINDS.map(k => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>
      <Details value={value} onChange={onChange} />
    </div>
  )
}
