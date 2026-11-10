import type { ReactNode } from 'react'

import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { bot } from './fixtures'

// The real screen needs a display: here the provider only records which bot it was mounted for.
const computer = vi.hoisted(() => ({ mounted: [] as string[], value: { screen: { view: { kind: 'live', control: 'bot' } }, live: { link: 'live' } } }))
vi.mock('@/features/side-panel/ComputerProvider', () => ({
  ComputerProvider: ({ bot: b, children }: { bot: { name: string }; children: ReactNode }) => {
    computer.mounted.push(b.name)
    return <>{children}</>
  },
  useComputerContext: () => computer.value
}))
vi.mock('@/features/side-panel/ScreenTab', () => ({ ScreenTab: ({ bot: b }: { bot: { name: string } }) => <div data-testid="screen-body">{b.name}</div> }))
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

  it('shows the link chip between the tabs and Close on Screen, and nothing there on Routines', () => {
    const { rerender, onTab, onClose } = show('computer')
    const slot = document.querySelector('[data-slot="side-chip"]')!
    expect(slot).toHaveTextContent('Live')
    expect(slot.compareDocumentPosition(screen.getByRole('tablist')) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(slot.compareDocumentPosition(screen.getByRole('button', { name: 'Close panel' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    rerender(<MemoryRouter><SidePanel bot={dev} tab="routines" onTab={onTab} onClose={onClose} /></MemoryRouter>)
    expect(document.querySelector('[data-slot="side-chip"]')).toBe(slot)
    expect(slot).toBeEmptyDOMElement()
  })

  it('mounts the computer only for the Screen tab and keeps the tab buttons mounted across a switch', () => {
    computer.mounted = []
    const { rerender, onTab, onClose } = show('routines')
    expect(computer.mounted).toEqual([])
    const routines = screen.getByRole('tab', { name: 'Routines' })
    rerender(<MemoryRouter><SidePanel bot={dev} tab="computer" onTab={onTab} onClose={onClose} /></MemoryRouter>)
    expect(new Set(computer.mounted)).toEqual(new Set(['dev']))
    // The same button, so a tab picked with the keyboard keeps focus.
    expect(screen.getByRole('tab', { name: 'Routines' })).toBe(routines)
  })
})
