import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ChoiceChips, OptionList, Section, Switch } from '@/components/console/fields'
import { IconButton } from '@/components/console/icon-button'
import { RolePicker } from '@/components/console/role-picker'
import { StatusChip, StatusDot, STATUS_LABEL } from '@/components/console/status'
import { TooltipProvider } from '@/components/ui/tooltip'

const OPTIONS = [
  { value: 'one', label: 'One', description: 'First' },
  { value: 'two', label: 'Two' }
]

describe('console fields', () => {
  it('Switch is a named switch with aria-checked and honours disabled', () => {
    const onChange = vi.fn()
    const { rerender } = render(<Switch checked={false} onChange={onChange} label="Let it use its screen" describedBy="hint" />)
    const sw = screen.getByRole('switch', { name: 'Let it use its screen' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(sw).toHaveAttribute('aria-describedby', 'hint')
    fireEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
    rerender(<Switch checked onChange={onChange} label="Let it use its screen" disabled />)
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('switch')).toBeDisabled()
    fireEvent.click(screen.getByRole('switch'))
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('OptionList and ChoiceChips are radio groups named by their legend', () => {
    const onChange = vi.fn()
    render(
      <>
        <OptionList legend="Mode" value="one" options={OPTIONS} onChange={onChange} />
        <ChoiceChips legend="Size" value={null} options={OPTIONS} onChange={onChange} disabled />
      </>
    )
    const mode = screen.getByRole('radiogroup', { name: 'Mode' })
    expect(mode).toBeInTheDocument()
    expect(within(mode).getByRole('radio', { name: /One/ })).toBeChecked()
    fireEvent.click(within(mode).getByRole('radio', { name: /Two/ }))
    expect(onChange).toHaveBeenCalledWith('two')
    const size = screen.getByRole('radiogroup', { name: 'Size' })
    expect(size.querySelectorAll('input:disabled')).toHaveLength(2)
  })

  it('RolePicker offers the six roles and None', () => {
    const onChange = vi.fn()
    render(<RolePicker value="ops" onChange={onChange} />)
    expect(screen.getByRole('radiogroup', { name: 'Role' })).toBeInTheDocument()
    const names = screen.getAllByRole('radio').map(r => r.closest('label')?.textContent)
    expect(names).toEqual(['Researcher', 'Engineer', 'Operator', 'Analyst', 'Ops', 'Generalist', 'None'])
    expect(screen.getByRole('radio', { name: 'Ops' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'None' }))
    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('disabled OptionList, ChoiceChips and RolePicker cannot be chosen and drop the pointer and hover styles', () => {
    const onChange = vi.fn()
    render(
      <>
        <OptionList legend="Mode" value="one" options={OPTIONS} onChange={onChange} disabled />
        <ChoiceChips legend="Size" value="one" options={OPTIONS} onChange={onChange} disabled />
        <RolePicker value="ops" onChange={onChange} disabled />
      </>
    )
    for (const name of ['Mode', 'Size', 'Role']) {
      const group = screen.getByRole('radiogroup', { name })
      expect(group).toHaveClass('disabled:opacity-60')
      const radios = within(group).getAllByRole('radio')
      for (const radio of radios) {
        expect(radio).toBeDisabled()
        // Native clicks, as a user's would be: jsdom toggles a disabled radio on a synthetic dispatched click.
        const label = radio.closest('label') as HTMLElement
        act(() => {
          radio.click()
          label.click()
        })
        expect(label).toHaveClass('cursor-not-allowed')
        expect(label.outerHTML).not.toMatch(/cursor-pointer|hover:/)
      }
    }
    expect(onChange).not.toHaveBeenCalled()
  })

  it('enabled choices keep the pointer cursor and are chosen by the same native click', () => {
    const onChange = vi.fn()
    render(<RolePicker value={null} onChange={onChange} />)
    const label = screen.getByRole('radio', { name: 'Ops' }).closest('label') as HTMLElement
    expect(label).toHaveClass('cursor-pointer')
    act(() => label.click())
    expect(onChange).toHaveBeenCalledWith('ops')
  })

  it('StatusDot pulses only for working and says the status to screen readers', () => {
    const { container, rerender } = render(<StatusDot status="working" />)
    expect(container.querySelector('.motion-safe\\:animate-status-pulse')).not.toBeNull()
    expect(screen.getByText('Working')).toHaveClass('sr-only')
    for (const status of ['idle', 'needs_you'] as const) {
      rerender(<StatusDot status={status} />)
      expect(container.querySelector('.motion-safe\\:animate-status-pulse')).toBeNull()
      expect(screen.getByText(STATUS_LABEL[status])).toHaveClass('sr-only')
    }
    expect(STATUS_LABEL).toEqual({ idle: 'Idle', working: 'Working', needs_you: 'Needs you' })
    rerender(<StatusChip status="needs_you" />)
    expect(screen.getAllByText('Needs you').length).toBeGreaterThan(0)
  })

  it('IconButton passes rest props and forwards its ref', () => {
    const ref = { current: null as HTMLButtonElement | null }
    render(
      <TooltipProvider>
        <IconButton ref={ref} label="Open menu" aria-expanded={false} aria-haspopup="menu" pressed><span /></IconButton>
      </TooltipProvider>
    )
    const button = screen.getByRole('button', { name: 'Open menu' })
    expect(ref.current).toBe(button)
    expect(button).toHaveAttribute('aria-haspopup', 'menu')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-pressed', 'true')
  })

  it('Section renders a section with an h3 and its hint', () => {
    render(<Section title="Sleep" hint="When idle"><p>body</p></Section>)
    expect(screen.getByRole('heading', { level: 3, name: 'Sleep' })).toBeInTheDocument()
    expect(screen.getByText('When idle')).toBeInTheDocument()
  })

  it('draws the unchosen radio ring and the off switch in colours that show on a light well (light review C1, C2)', () => {
    render(<><OptionList legend="Pick" value="one" options={OPTIONS} onChange={() => {}} /><Switch checked={false} onChange={() => {}} label="Off" /><Switch checked onChange={() => {}} label="On" /></>)
    for (const radio of screen.getAllByRole('radio')) {
      const ring = radio.nextElementSibling!
      expect(ring).toHaveClass('border-ring')
      expect(ring).not.toHaveClass('border-control')
    }
    const off = screen.getByRole('switch', { name: 'Off' })
    expect(off).toHaveClass('bg-switch-off')
    expect(off).not.toHaveClass('bg-control')
    expect(off.firstElementChild).toHaveClass('bg-shell', 'dark:bg-background')
    expect(screen.getByRole('switch', { name: 'On' })).toHaveClass('bg-watermelon')
  })
})
