import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Shell } from '@/layout/Shell'

const parts = { rail: <div>crew</div>, main: <div>chat</div> }
const side = <div>right</div>

/** A window `width` px wide: only the max-width queries that include it match. */
const mockMedia = (width: number) => {
  window.matchMedia = ((query: string) => ({
    matches: Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? -1) >= width, media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false
  })) as typeof window.matchMedia
}

const rail = () => screen.getByRole('complementary', { name: 'Sidebar' })
const main = () => screen.getByRole('main')
const panel = () => screen.getByRole('region', { name: 'Panel' })

describe('Shell', () => {
  it('renders the rail and main without the side panel when there is none', () => {
    render(<Shell {...parts} side={null} />)
    expect(rail()).toHaveTextContent('crew')
    expect(main()).toHaveTextContent('chat')
    expect(screen.queryByRole('region', { name: 'Panel' })).toBeNull()
    expect(screen.queryByText('right')).toBeNull()
  })

  it('renders the side panel when given one', () => {
    render(<Shell {...parts} side={side} />)
    expect(panel()).toHaveTextContent('right')
  })
})

describe('Shell panels', () => {
  it('renders three rounded shell panels straight on the page canvas', () => {
    mockMedia(1440)
    const { container } = render(<Shell {...parts} side={side} />)
    for (const el of [rail(), main(), panel()]) expect(el).toHaveClass('rounded-3xl', 'bg-shell', 'shadow-panel')
    expect(container.firstElementChild).toHaveClass('flex', 'h-dvh', 'gap-2', 'bg-background', 'p-2')
    // The canvas is the root's own background; there is no decorative layer.
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
    expect(rail()).toHaveClass('w-[272px]', 'flex-none')
  })

  it('gives the conversation the clamp width beside a side panel, which takes the rest', () => {
    mockMedia(1440)
    render(<Shell {...parts} side={side} />)
    expect(main()).toHaveClass('w-[clamp(380px,32vw,480px)]', 'flex-none')
    expect(main()).not.toHaveClass('flex-1')
    expect(panel()).toHaveClass('flex-1')
  })

  it('lets main take the remaining width with no side panel', () => {
    mockMedia(1440)
    render(<Shell {...parts} side={null} />)
    expect(main()).toHaveClass('flex-1')
    expect(main().className).not.toContain('clamp')
  })

  it.each([1000, 1100, 1200, 1279])('lays the side panel over main below 1280 px (%i px)', width => {
    mockMedia(width)
    render(<Shell {...parts} side={side} />)
    expect(panel()).toHaveAttribute('data-overlay', 'true')
    expect(panel()).toHaveClass('absolute', 'w-[min(480px,calc(100%-16px))]', 'bg-shell', 'rounded-3xl')
    expect(panel()).not.toHaveClass('flex-1')
    // The conversation keeps the full width under the overlay.
    expect(main()).toHaveClass('flex-1')
    expect(main().className).not.toContain('clamp')
  })

  it('lifts the narrow-window overlay with its own shadow', () => {
    mockMedia(1100)
    render(<Shell {...parts} side={side} />)
    expect(panel()).toHaveClass('shadow-2xl')
    expect(panel()).not.toHaveClass('shadow-panel')
  })

  it('sits the side panel beside main from 1280 px', () => {
    for (const width of [1280, 1440]) {
      mockMedia(width)
      const { unmount } = render(<Shell {...parts} side={side} />)
      expect(panel()).not.toHaveAttribute('data-overlay')
      expect(panel()).not.toHaveClass('absolute')
      unmount()
    }
  })
})
