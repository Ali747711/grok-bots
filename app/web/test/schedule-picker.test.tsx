import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { SchedulePicker } from '@/features/routines/SchedulePicker'
import type { ScheduleSpec } from '@/features/routines/types'

import { pickOption } from './select-helpers'

function Harness({ initial, spy }: { initial: ScheduleSpec; spy: (s: ScheduleSpec) => void }) {
  const [value, setValue] = useState(initial)
  return <SchedulePicker value={value} onChange={next => { setValue(next); spy(next) }} />
}
const setup = (initial: ScheduleSpec = { kind: 'daily', time: '09:00' }) => {
  const spy = vi.fn()
  render(<Harness initial={initial} spy={spy} />)
  return spy
}
const set = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const last = (spy: ReturnType<typeof vi.fn>) => spy.mock.calls.at(-1)?.[0]

describe('SchedulePicker', () => {
  it('uses a Select for When and keeps free typing in amounts', () => {
    const spy = setup()
    expect(screen.getByRole('combobox', { name: 'When' })).toHaveTextContent('Every day')
    pickOption('When', 'Every…')
    expect(screen.getByRole('combobox', { name: 'When' })).toHaveTextContent('Every…')
    expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveTextContent('hours')
    const amount = screen.getByLabelText('Amount')
    fireEvent.change(amount, { target: { value: '' } })
    expect(amount).toHaveValue(null)
    fireEvent.change(amount, { target: { value: '45' } })
    expect(amount).toHaveValue(45)
    expect(last(spy)).toEqual({ kind: 'every', amount: 45, unit: 'h' })
  })

  it('emits Weekdays with the chosen time', () => {
    const spy = setup()
    pickOption('When', 'Weekdays')
    set('Time', '09:30')
    expect(last(spy)).toEqual({ kind: 'weekdays', time: '09:30' })
  })

  it('emits Once after an amount and unit', () => {
    const spy = setup()
    pickOption('When', 'Once, after…')
    set('Amount', '30')
    pickOption('Unit', 'minutes')
    expect(last(spy)).toEqual({ kind: 'once_in', amount: 30, unit: 'm' })
  })

  it('emits Once at a date and time', () => {
    const spy = setup()
    pickOption('When', 'Once, at…')
    set('Date and time', '2026-12-01T08:15')
    expect(last(spy)).toEqual({ kind: 'once_at', at: '2026-12-01T08:15' })
  })

  it('emits Every with an amount and unit', () => {
    const spy = setup()
    pickOption('When', 'Every…')
    set('Amount', '2')
    pickOption('Unit', 'hours')
    expect(last(spy)).toEqual({ kind: 'every', amount: 2, unit: 'h' })
  })

  it('emits Every day', () => {
    const spy = setup({ kind: 'weekdays', time: '07:00' })
    pickOption('When', 'Every day')
    expect(last(spy)).toEqual({ kind: 'daily', time: '07:00' })
  })

  it('emits Every week with a day (Sunday is 0)', () => {
    const spy = setup()
    pickOption('When', 'Every week')
    pickOption('Day of the week', 'Sunday')
    set('Time', '18:00')
    expect(last(spy)).toEqual({ kind: 'weekly', day: 0, time: '18:00' })
  })

  it('emits Every month with a day 1-31', () => {
    const spy = setup()
    pickOption('When', 'Every month')
    set('Day of the month', '31')
    expect(last(spy)).toEqual({ kind: 'monthly', day: 31, time: '09:00' })
  })

  it('emits a custom cron expression', () => {
    const spy = setup()
    pickOption('When', 'Custom (cron)')
    set('Cron expression', '*/5 * * * *')
    expect(last(spy)).toEqual({ kind: 'cron', expr: '*/5 * * * *' })
  })

  it('keeps the amount inside 1-999', () => {
    const spy = setup({ kind: 'every', amount: 5, unit: 'm' })
    set('Amount', '5000')
    expect(last(spy)).toEqual({ kind: 'every', amount: 999, unit: 'm' })
    set('Amount', '0')
    expect(last(spy)).toEqual({ kind: 'every', amount: 1, unit: 'm' })
  })

  it('labels the kind select When', () => {
    setup()
    expect(screen.getByRole('combobox', { name: 'When' })).toBeInTheDocument()
  })

  it('lets the amount be cleared and retyped', () => {
    const spy = setup({ kind: 'every', amount: 5, unit: 'm' })
    spy.mockClear()
    set('Amount', '')
    expect(spy).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Amount')).toHaveValue(null)
    set('Amount', '30')
    expect(last(spy)).toEqual({ kind: 'every', amount: 30, unit: 'm' })
    expect(screen.getByLabelText('Amount')).toHaveValue(30)
  })

  it('clamps the shown amount on blur', () => {
    setup({ kind: 'every', amount: 5, unit: 'm' })
    set('Amount', '0')
    fireEvent.blur(screen.getByLabelText('Amount'))
    expect(screen.getByLabelText('Amount')).toHaveValue(1)
    set('Amount', '1200')
    fireEvent.blur(screen.getByLabelText('Amount'))
    expect(screen.getByLabelText('Amount')).toHaveValue(999)
  })

  it('lets the day of the month be cleared and retyped', () => {
    const spy = setup({ kind: 'monthly', day: 15, time: '09:00' })
    set('Day of the month', '')
    set('Day of the month', '7')
    expect(last(spy)).toEqual({ kind: 'monthly', day: 7, time: '09:00' })
    set('Day of the month', '45')
    fireEvent.blur(screen.getByLabelText('Day of the month'))
    expect(screen.getByLabelText('Day of the month')).toHaveValue(31)
  })
})
