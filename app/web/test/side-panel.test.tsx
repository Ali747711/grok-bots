import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { bot } from './fixtures'

vi.mock('@/features/computer/ComputerPanel', () => ({ ComputerPanel: ({ bot: b }: { bot: { name: string } }) => <div data-testid="screen-body">{b.name}</div> }))
vi.mock('@/features/routines/RoutinesPanel', () => ({ RoutinesPanel: ({ bot: b }: { bot: { name: string } }) => <div data-testid="routines-body">{b.name}</div> }))

const { SidePanel } = await import('@/features/side-panel/SidePanel')

const dev = bot({ name: 'dev', title: 'Dev' })
const show = (tab: 'computer' | 'routines', onTab = vi.fn(), onClose = vi.fn()) => {
  const view = render(<MemoryRouter><SidePanel bot={dev} tab={tab} onTab={onTab} onClose={onClose} /></MemoryRouter>)
  return { ...view, onTab, onClose }
}

describe('SidePanel', () => {
  it('has the tabs Screen and Routines with aria-selected, and shows only the open tab', () => {
    const { rerender, onTab, onClose } = show('computer')
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Screen', 'Routines'])
    expect(screen.getByRole('tab', { name: 'Screen' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Routines' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Screen' })).toHaveAttribute('id', 'side-tab-computer')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'side-panel')
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'side-tab-computer')
    expect(screen.getByTestId('screen-body')).toHaveTextContent('dev')
    expect(screen.queryByTestId('routines-body')).toBeNull()

    rerender(<MemoryRouter><SidePanel bot={dev} tab="routines" onTab={onTab} onClose={onClose} /></MemoryRouter>)
    expect(screen.getByRole('tab', { name: 'Routines' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('routines-body')).toBeInTheDocument()
    expect(screen.queryByTestId('screen-body')).toBeNull()
  })

  it('reports a tab click and an arrow key', () => {
    const { onTab } = show('computer')
    fireEvent.click(screen.getByRole('tab', { name: 'Routines' }))
    expect(onTab).toHaveBeenLastCalledWith('routines')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Screen' }), { key: 'ArrowRight' })
    expect(onTab).toHaveBeenCalledTimes(2)
  })

  it('Close panel calls onClose', () => {
    const { onClose } = show('routines')
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps an empty slot for the link chip between the tabs and Close', () => {
    show('computer')
    const slot = document.querySelector('[data-slot="side-chip"]')
    expect(slot).not.toBeNull()
    expect(slot).toBeEmptyDOMElement()
  })
})
