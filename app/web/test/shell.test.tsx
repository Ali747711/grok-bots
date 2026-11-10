import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Shell } from '@/layout/Shell'

const parts = { sidebar: <div>side</div>, main: <div>chat</div>, panel: <div>right</div> }

describe('Shell', () => {
  it('renders sidebar and main without the panel when closed', () => {
    render(<Shell {...parts} panelOpen={false} />)
    expect(screen.getByRole('complementary', { name: 'Sidebar' })).toHaveTextContent('side')
    expect(screen.getByRole('main')).toHaveTextContent('chat')
    expect(screen.queryByRole('region', { name: 'Panel' })).toBeNull()
    expect(screen.queryByText('right')).toBeNull()
  })

  it('renders the panel when open', () => {
    render(<Shell {...parts} panelOpen />)
    expect(screen.getByRole('region', { name: 'Panel' })).toHaveTextContent('right')
  })
})

/** A window `width` px wide: only the max-width queries that include it match. */
const mockMedia = (width: number) => {
  window.matchMedia = ((query: string) => ({
    matches: Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? -1) >= width, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false
  })) as typeof window.matchMedia
}

describe('Shell blocks', () => {
  it('renders three rounded shell panels straight on the page canvas', () => {
    mockMedia(1440)
    const { container } = render(<Shell {...parts} panelOpen />)
    for (const el of [screen.getByRole('complementary', { name: 'Sidebar' }), screen.getByRole('main'), screen.getByRole('region', { name: 'Panel' })]) {
      expect(el).toHaveClass('rounded-3xl', 'bg-shell', 'shadow-panel')
    }
    // The body's --background is the canvas; there is no decorative layer any more.
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(container.firstElementChild!.className).toContain('grid-cols-[272px_minmax(0,1fr)_400px]')
  })

  it('lifts the narrow-window overlay with its own shadow', () => {
    mockMedia(1100)
    render(<Shell {...parts} panelOpen />)
    const panel = screen.getByRole('region', { name: 'Panel' })
    expect(panel).toHaveClass('bg-shell', 'shadow-2xl')
    expect(panel).not.toHaveClass('shadow-panel')
  })

  it.each([1000, 1100, 1200, 1279])('opens the panel as an overlay below 1280 px (%i px)', width => {
    mockMedia(width)
    const { container } = render(<Shell {...parts} panelOpen />)
    expect(screen.getByRole('region', { name: 'Panel' })).toHaveAttribute('data-overlay', 'true')
    expect(container.firstElementChild!.className).toContain('grid-cols-[272px_minmax(0,1fr)]')
    expect(container.firstElementChild!.className).not.toContain('400px')
  })

  it('keeps three columns from 1280 px', () => {
    mockMedia(1280)
    const { container } = render(<Shell {...parts} panelOpen />)
    expect(screen.getByRole('region', { name: 'Panel' })).not.toHaveAttribute('data-overlay')
    expect(container.firstElementChild!.className).toContain('grid-cols-[272px_minmax(0,1fr)_400px]')
  })

  it('does not overlay on a wide window', () => {
    mockMedia(1440)
    render(<Shell {...parts} panelOpen />)
    expect(screen.getByRole('region', { name: 'Panel' })).not.toHaveAttribute('data-overlay')
  })
})
