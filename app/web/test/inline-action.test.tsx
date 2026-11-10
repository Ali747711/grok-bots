import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { InlineAction } from '@/components/console/inline-action'
import { CrewApiError } from '@/lib/crew-json'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function setup(onAction: () => Promise<void>) {
  render(<InlineAction label="Sandbox" icon={<span />} actionText="Reset sandbox" onAction={onAction} />)
}
const press = async (name: string) => {
  await act(async () => { fireEvent.click(screen.getByRole('button', { name })) })
}

describe('InlineAction', () => {
  it('shows loading, then success, then idle after 2 s', async () => {
    let resolve!: () => void
    setup(() => new Promise<void>(r => { resolve = r }))
    await press('Reset sandbox')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    await act(async () => { resolve() })
    expect(screen.getByRole('status')).toHaveTextContent('Done')
    await act(async () => { await vi.advanceTimersByTimeAsync(1900) })
    expect(screen.getByRole('status')).toHaveTextContent('Done')
    await act(async () => { await vi.advanceTimersByTimeAsync(200) })
    expect(screen.queryByText('Done')).toBeNull()
    expect(screen.getByRole('button', { name: 'Reset sandbox' })).toBeInTheDocument()
  })

  it('keeps focus on the action while loading and on Try again after a failure', async () => {
    let reject!: (error: Error) => void
    setup(() => new Promise<void>((_, r) => { reject = r }))
    const button = screen.getByRole('button', { name: 'Reset sandbox' })
    button.focus()
    await press('Reset sandbox')
    expect(screen.getByRole('progressbar')).toBeInTheDocument()
    expect(document.activeElement).toBe(button)
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(button).toHaveAttribute('aria-disabled', 'true')
    await act(async () => { reject(new Error('No room')) })
    expect(screen.getByRole('alert')).toHaveTextContent('No room')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('button', { name: 'Try again' })).not.toHaveAttribute('aria-busy')
  })

  it('ignores a second activation while loading', async () => {
    const action = vi.fn(() => new Promise<void>(() => {}))
    setup(action)
    const button = screen.getByRole('button', { name: 'Reset sandbox' })
    await act(async () => {
      fireEvent.click(button)
      fireEvent.click(button)
    })
    await act(async () => { fireEvent.click(button) })
    expect(action).toHaveBeenCalledTimes(1)
  })

  it('shows the refusal text and Try again when the action rejects, and never returns to idle on its own', async () => {
    setup(() => Promise.reject(new CrewApiError(409, { message: 'Not enough memory' })))
    await press('Reset sandbox')
    expect(screen.getByRole('alert')).toHaveTextContent('Not enough memory')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(screen.getByRole('alert')).toHaveTextContent('Not enough memory')
  })

  it('falls back to body.error, then the Error message', async () => {
    const first = vi.fn().mockRejectedValue(new CrewApiError(500, { error: 'boom' }))
    setup(first)
    await press('Reset sandbox')
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
    cleanupAndRender(new Error('plain failure'))
    await press('Reset sandbox')
    expect(screen.getByRole('alert')).toHaveTextContent('plain failure')
  })

  it('retries from the error state', async () => {
    const action = vi.fn().mockRejectedValueOnce(new CrewApiError(409, { message: 'Busy' })).mockResolvedValueOnce(undefined)
    setup(action)
    await press('Reset sandbox')
    await press('Try again')
    expect(action).toHaveBeenCalledTimes(2)
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

function cleanupAndRender(error: Error) {
  cleanup()
  setup(() => Promise.reject(error))
}
