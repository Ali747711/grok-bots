import { render, screen } from '@testing-library/react'
import { useReducedMotion } from 'motion/react'
import { describe, expect, it, vi } from 'vitest'

import { IndeterminateBar } from '@/components/console/motion-bits'

vi.mock('motion/react', async original => ({ ...(await original<typeof import('motion/react')>()), useReducedMotion: vi.fn() }))

const fill = () => screen.getByRole('progressbar').firstElementChild as HTMLElement

describe('IndeterminateBar', () => {
  it('loops when motion is allowed', () => {
    vi.mocked(useReducedMotion).mockReturnValue(false)
    render(<IndeterminateBar label="Saving" />)
    expect(screen.getByRole('progressbar', { name: 'Saving' })).toBeInTheDocument()
    expect(fill()).toHaveAttribute('data-motion', 'loop')
    expect(fill().style.left).not.toBe('')
  })

  it('is a static bar under reduced motion', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true)
    render(<IndeterminateBar label="Saving" />)
    expect(screen.getByRole('progressbar', { name: 'Saving' })).toBeInTheDocument()
    expect(fill()).toHaveAttribute('data-motion', 'static')
    expect(fill().style.left).toBe('')
  })
})
