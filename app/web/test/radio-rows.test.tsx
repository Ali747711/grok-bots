import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RadioRows } from '@/components/console/radio-rows'

const OPTIONS = [
  { value: 'schedule', label: 'On a schedule' },
  { value: 'triggered', label: 'Only when triggered' }
] as const

describe('RadioRows', () => {
  it('is a group with a visible legend holding one radio group of the same name', () => {
    render(<RadioRows legend="Runs" value="schedule" options={OPTIONS} onChange={() => {}} />)
    const legend = screen.getByText('Runs', { selector: 'legend' })
    expect(legend).not.toHaveClass('sr-only')
    const group = screen.getByRole('group', { name: 'Runs' })
    const radios = within(group).getByRole('radiogroup', { name: 'Runs' })
    expect(within(radios).getAllByRole('radio')).toHaveLength(2)
  })

  it('names each radio by its label alone and marks the chosen one', () => {
    render(<RadioRows legend="Runs" value="triggered" options={OPTIONS} onChange={() => {}} />)
    expect(screen.getByRole('radio', { name: 'Only when triggered' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'On a schedule' })).not.toBeChecked()
  })

  it('reports the picked value', () => {
    const onChange = vi.fn()
    render(<RadioRows legend="Runs" value="schedule" options={OPTIONS} onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Only when triggered' }))
    expect(onChange).toHaveBeenCalledWith('triggered')
  })

  it('keeps the real radio over its whole row, so a click or check on the radio itself lands on it', () => {
    // triggers.spec calls .check() on the radios: one hidden off-screen (sr-only) cannot be clicked.
    render(<RadioRows legend="Runs" value="schedule" options={OPTIONS} onChange={() => {}} />)
    for (const radio of screen.getAllByRole('radio')) {
      expect(radio).not.toHaveClass('sr-only')
      expect(radio).toHaveClass('absolute', 'inset-0')
      expect(radio.closest('label')).toHaveClass('relative')
    }
  })

  it('keeps two groups on one page apart', () => {
    render(
      <>
        <RadioRows legend="Runs" value="schedule" options={OPTIONS} onChange={() => {}} />
        <RadioRows legend="Source" value="triggered" options={OPTIONS} onChange={() => {}} />
      </>
    )
    expect(within(screen.getByRole('group', { name: 'Runs' })).getByRole('radio', { name: 'On a schedule' })).toBeChecked()
    expect(within(screen.getByRole('group', { name: 'Source' })).getByRole('radio', { name: 'Only when triggered' })).toBeChecked()
  })

  it('shows what is passed below the rows inside the group', () => {
    render(<RadioRows legend="Runs" value="schedule" options={OPTIONS} onChange={() => {}}><p>Hint</p></RadioRows>)
    expect(within(screen.getByRole('group', { name: 'Runs' })).getByText('Hint')).toBeInTheDocument()
  })
})
