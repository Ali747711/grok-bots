import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { WorkBlock } from '@/features/chat/WorkBlock'
import type { ChatItem, WorkStep } from '@/chat/types'

type Work = Extract<ChatItem, { kind: 'work' }>
const step = (over: Partial<WorkStep> = {}): WorkStep => ({ id: 's1', name: 'terminal', summary: 'echo hi', running: false, ...over })
const work = (steps: WorkStep[], durationS?: number): Work => ({ kind: 'work', id: 'w', steps, ...(durationS !== undefined ? { durationS } : {}) })

describe('WorkBlock', () => {
  it('renders nothing for a block without steps', () => {
    const { container } = render(<WorkBlock item={work([])} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is collapsed by default with the duration and step count', () => {
    render(<WorkBlock item={work([step(), step({ id: 's2' })], 3.4)} />)
    expect(screen.getByRole('button', { name: /Worked for 3s · 2 steps/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('echo hi')).toBeNull()
  })

  it('omits the duration when unknown and uses the singular for one step', () => {
    render(<WorkBlock item={work([step()])} />)
    expect(screen.getByRole('button', { name: 'Worked · 1 step' })).toBeInTheDocument()
  })

  it('expands to step name and summary and marks error steps', () => {
    render(<WorkBlock item={work([step(), step({ id: 's2', name: 'read_file', summary: 'notes.txt', isError: true })])} />)
    fireEvent.click(screen.getByRole('button', { name: /Worked/ }))
    expect(screen.getByText('echo hi')).toBeInTheDocument()
    expect(screen.getByText('notes.txt')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  it('shows Working while a step runs', () => {
    render(<WorkBlock item={work([step({ running: true })])} />)
    expect(screen.getByRole('button', { name: /Working · 1 step/ })).toBeInTheDocument()
  })

  it('truncates long output to 4000 characters with Show more', () => {
    const detail = 'x'.repeat(10_000)
    render(<WorkBlock item={work([step({ detail })])} />)
    fireEvent.click(screen.getByRole('button', { name: /Worked/ }))
    const pre = screen.getByTestId('step-detail')
    expect(pre.textContent).toHaveLength(4000)
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByTestId('step-detail').textContent).toHaveLength(10_000)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('does not offer Show more for short output', () => {
    render(<WorkBlock item={work([step({ detail: 'ok' })])} />)
    fireEvent.click(screen.getByRole('button', { name: /Worked/ }))
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })
})
