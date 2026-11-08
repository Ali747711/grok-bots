import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { PanelBoundary } from '@/features/panel/PanelBoundary'
import { formatInZone } from '@/features/routines/use-schedule-preview'

afterEach(() => vi.restoreAllMocks())

function Boom(): never {
  throw new Error('render failed')
}

describe('PanelBoundary', () => {
  it('shows a message and a Reload button instead of blanking the app', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const reload = vi.fn()
    render(<PanelBoundary onReload={reload}><Boom /></PanelBoundary>)
    expect(screen.getByText('Something went wrong in this panel')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
    expect(reload).toHaveBeenCalled()
  })

  it('renders its children when nothing fails', () => {
    render(<PanelBoundary><p>fine</p></PanelBoundary>)
    expect(screen.getByText('fine')).toBeInTheDocument()
  })
})

describe('formatInZone', () => {
  it('formats in the given zone', () => {
    expect(formatInZone(Date.UTC(2026, 10, 9, 9, 0), 'Asia/Tokyo')).toMatch(/6:00\s?PM/)
  })

  it('falls back to UTC, labelled, for a zone the browser does not know', () => {
    const text = formatInZone(Date.UTC(2026, 10, 9, 9, 0), 'Mars/Olympus')
    expect(text).toMatch(/9:00\s?AM/)
    expect(text).toContain('UTC')
  })
})
