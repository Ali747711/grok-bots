import { fireEvent, render, screen } from '@testing-library/react'
import { Brain, Cpu, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { SegmentedTabs } from '@/components/console/segmented-tabs'

const TABS = [
  { id: 'a', label: 'Alpha', icon: Brain },
  { id: 'b', label: 'Beta', icon: Cpu },
  { id: 'c', label: 'Gamma', icon: Sparkles }
] as const

function Host() {
  const [value, setValue] = useState<'a' | 'b' | 'c'>('a')
  return <SegmentedTabs tabs={[...TABS]} value={value} onChange={setValue} label="Sections" idPrefix="t" />
}

describe('SegmentedTabs', () => {
  it('is a tablist with one tabbable tab and moves with ←, →, Home and End', () => {
    render(<Host />)
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeInTheDocument()
    const tabs = screen.getAllByRole('tab')
    expect(tabs.filter(t => t.tabIndex === 0)).toHaveLength(1)
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Beta' })).toHaveAttribute('aria-selected', 'true')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Beta' }))
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Beta' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Gamma' }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowLeft' })
    expect(screen.getByRole('tab', { name: 'Gamma' })).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Gamma' }), { key: 'Home' })
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getAllByRole('tab').filter(t => t.tabIndex === 0)).toHaveLength(1)
  })

  it('leaves Alt+Arrow to the browser', () => {
    render(<Host />)
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Alpha' }), { key: 'ArrowRight', altKey: true })
    expect(screen.getByRole('tab', { name: 'Alpha' })).toHaveAttribute('aria-selected', 'true')
  })
})
