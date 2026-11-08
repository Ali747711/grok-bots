import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

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

const mockMedia = (narrow: boolean) => {
  window.matchMedia = ((query: string) => ({
    matches: narrow && query === '(max-width: 1099px)', media: query, onchange: null,
    addEventListener: () => undefined, removeEventListener: () => undefined,
    addListener: () => undefined, removeListener: () => undefined, dispatchEvent: () => false
  })) as typeof window.matchMedia
}

describe('Shell blocks and canvas', () => {
  afterEach(() => { delete document.documentElement.dataset.theme })

  it('renders three rounded blocks on the sky canvas', () => {
    mockMedia(false)
    const { container } = render(<Shell {...parts} panelOpen />)
    for (const el of [screen.getByRole('complementary', { name: 'Sidebar' }), screen.getByRole('main'), screen.getByRole('region', { name: 'Panel' })]) {
      expect(el).toHaveClass('rounded-block')
      expect(el.className).toMatch(/\bbg-card(\/95)?\b/)
    }
    const canvas = container.querySelector('[data-canvas]')
    expect(canvas).toHaveAttribute('aria-hidden', 'true')
    expect(container.firstElementChild!.className).toContain('grid-cols-[272px_minmax(0,1fr)_400px]')
  })

  it('opens the panel as an overlay below 1100 px', () => {
    mockMedia(true)
    const { container } = render(<Shell {...parts} panelOpen />)
    expect(screen.getByRole('region', { name: 'Panel' })).toHaveAttribute('data-overlay', 'true')
    expect(container.firstElementChild!.className).toContain('grid-cols-[272px_minmax(0,1fr)]')
    expect(container.firstElementChild!.className).not.toContain('400px')
  })

  it('does not overlay on a wide window', () => {
    mockMedia(false)
    render(<Shell {...parts} panelOpen />)
    expect(screen.getByRole('region', { name: 'Panel' })).not.toHaveAttribute('data-overlay')
  })

  it('switches the canvas when the theme changes', async () => {
    mockMedia(false)
    document.documentElement.dataset.theme = 'light'
    const { container } = render(<Shell {...parts} panelOpen={false} />)
    expect(container.querySelector('[data-canvas]')).toHaveAttribute('data-variant', 'sky')
    act(() => { document.documentElement.dataset.theme = 'dark' })
    await waitFor(() => expect(container.querySelector('[data-canvas]')).toHaveAttribute('data-variant', 'flat'))
    act(() => { document.documentElement.dataset.theme = 'light' })
    await waitFor(() => expect(container.querySelector('[data-canvas]')).toHaveAttribute('data-variant', 'sky'))
  })
})
