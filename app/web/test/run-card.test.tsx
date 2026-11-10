import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RunCard, runLabel } from '@/features/chat/RunCard'
import type { ChatItem, WorkStep } from '@/chat/types'

type Work = Extract<ChatItem, { kind: 'work' }>
const step = (over: Partial<WorkStep> = {}): WorkStep => ({ id: 's1', name: 'terminal', summary: 'echo hi', running: false, ...over })
const work = (steps: WorkStep[], over: Partial<Work> = {}): Work => ({ kind: 'work', id: 'w', steps, ...over })
const pill = () => screen.getAllByRole('button')[0]!
const open = () => fireEvent.click(pill())

describe('runLabel', () => {
  it('uses Crew\'s copy for running, done, done without a duration and interrupted', () => {
    expect(runLabel(work([step({ running: true })]))).toBe('Working · 1 step')
    expect(runLabel(work([step(), step({ id: 's2', running: true })]))).toBe('Working · 2 steps')
    expect(runLabel(work([step(), step({ id: 's2' })], { durationS: 12.4 }))).toBe('Worked for 12s · 2 steps')
    expect(runLabel(work([step()]))).toBe('Worked · 1 step')
    expect(runLabel(work([step(), step({ id: 's2' })], { durationS: 3, interrupted: true }))).toBe('Stopped after 2 steps')
    expect(runLabel(work([step()], { interrupted: true }))).toBe('Stopped after 1 step')
  })
})

describe('RunCard', () => {
  it('renders nothing for a block without steps', () => {
    const { container } = render(<RunCard item={work([])} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the running step summary, Working · n steps and a progress bar while running', () => {
    render(<RunCard item={work([step(), step({ id: 's2', name: 'read_file', summary: 'notes.txt', running: true })])} />)
    expect(pill()).toHaveAttribute('aria-expanded', 'false')
    expect(pill()).toHaveTextContent('notes.txt')
    expect(pill()).not.toHaveTextContent('echo hi')
    expect(screen.getByText('Working · 2 steps')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
  })

  it('shows Worked for 12s · 4 steps when done and Worked · 1 step without a duration', () => {
    const four = ['a', 'b', 'c', 'd'].map(id => step({ id }))
    const { unmount } = render(<RunCard item={work(four, { durationS: 12.2 })} />)
    expect(screen.getByRole('button', { name: 'Worked for 12s · 4 steps' })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect(screen.queryByText('echo hi')).toBeNull()
    unmount()
    render(<RunCard item={work([step()])} />)
    expect(screen.getByRole('button', { name: 'Worked · 1 step' })).toBeInTheDocument()
  })

  it('shows Stopped after 2 steps for an interrupted turn', () => {
    render(<RunCard item={work([step(), step({ id: 's2' })], { durationS: 5, interrupted: true })} />)
    expect(screen.getByRole('button', { name: 'Stopped after 2 steps' })).toBeInTheDocument()
    expect(screen.queryByText(/Worked/)).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })

  it('expands to the step list with done, running and failed markers', () => {
    render(<RunCard item={work([
      step(),
      step({ id: 's2', name: 'read_file', summary: 'notes.txt', isError: true }),
      step({ id: 's3', name: 'browser', summary: 'open page', running: true })
    ])} />)
    open()
    expect(pill()).toHaveAttribute('aria-expanded', 'true')
    const steps = screen.getAllByRole('listitem')
    expect(steps.map(s => s.dataset.state)).toEqual(['done', 'failed', 'running'])
    expect(within(steps[0]!).getByText('terminal')).toBeInTheDocument()
    expect(within(steps[0]!).getByText('echo hi')).toBeInTheDocument()
    expect(within(steps[0]!).queryByText('Failed')).toBeNull()
    expect(within(steps[1]!).getByText('Failed')).toBeInTheDocument()
    expect(steps[2]).toHaveAttribute('aria-current', 'step')
    expect(steps[0]).not.toHaveAttribute('aria-current')
    open()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('marks a failed step without destructive text on a tinted fill', () => {
    render(<RunCard item={work([step({ isError: true })])} />)
    open()
    const failed = screen.getByText('Failed')
    expect(failed.className).not.toMatch(/bg-destructive/)
    expect(failed.closest('[class*="bg-destructive"]')).toBeNull()
  })

  it('keeps Show more past 4000 characters', () => {
    const detail = 'x'.repeat(10_000)
    render(<RunCard item={work([step({ detail })])} />)
    open()
    expect(screen.queryByTestId('step-detail')).toBeNull()
    const row = screen.getByRole('button', { name: /terminal/ })
    expect(row).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(row)
    expect(row).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('step-detail').textContent).toHaveLength(4000)
    fireEvent.click(screen.getByRole('button', { name: 'Show more' }))
    expect(screen.getByTestId('step-detail').textContent).toHaveLength(10_000)
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })

  it('does not offer Show more for short output, and a step without output is not a button', () => {
    render(<RunCard item={work([step({ detail: 'ok' }), step({ id: 's2', name: 'read_file', summary: 'notes.txt' })])} />)
    open()
    expect(screen.queryByRole('button', { name: /read_file/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /terminal/ }))
    expect(screen.getByTestId('step-detail')).toHaveTextContent('ok')
    expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull()
  })
})
