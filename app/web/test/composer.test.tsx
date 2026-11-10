import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Composer } from '@/features/chat/Composer'
import { composerDisabledReason } from '@/features/chat/disabled-reason'

const base = { draftKey: 'bot:dev', onSend: vi.fn(), onStop: vi.fn(), running: false, disabledReason: null as string | null }
const box = () => screen.getByRole('textbox')

describe('Composer', () => {
  it('sends on Enter and clears the box; Shift+Enter does not send', () => {
    const onSend = vi.fn()
    render(<Composer {...base} onSend={onSend} />)
    fireEvent.change(box(), { target: { value: 'hello' } })
    fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })
    expect(onSend).not.toHaveBeenCalled()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('hello')
    expect(box()).toHaveValue('')
  })

  it('does not send blank text', () => {
    const onSend = vi.fn()
    render(<Composer {...base} onSend={onSend} />)
    fireEvent.change(box(), { target: { value: '   ' } })
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('is disabled with the reason shown', () => {
    const onSend = vi.fn()
    render(<Composer {...base} onSend={onSend} disabledReason="2 bots are working — wait or stop one" />)
    expect(box()).toBeDisabled()
    expect(screen.getByText('2 bots are working — wait or stop one')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('uses the primary round send button and keeps the disabled reason visible', () => {
    const { rerender } = render(<Composer {...base} />)
    expect(screen.getByRole('button', { name: 'Send' })).toHaveClass('bg-primary', 'rounded-full')
    rerender(<Composer {...base} disabledReason="Hermes is offline" />)
    expect(screen.getByRole('status')).toHaveTextContent('Hermes is offline')
    expect(screen.getByRole('status')).toHaveClass('text-muted-foreground')
  })

  it('names the icon-only Send button and offers a Send tooltip on hover', async () => {
    render(<Composer {...base} />)
    const send = screen.getByRole('button', { name: 'Send' })
    expect(send).toHaveAttribute('aria-label', 'Send')
    fireEvent.focus(send)
    expect(await screen.findByText('Send', { selector: '[data-slot=tooltip-content]' })).toBeInTheDocument()
  })

  it('shows Stop instead of Send while running', () => {
    const onStop = vi.fn()
    render(<Composer {...base} running onStop={onStop} />)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })

  it('keeps its text in the draft store under its key, and drops it once sent', () => {
    const onSend = vi.fn()
    const first = render(<Composer {...base} onSend={onSend} />)
    fireEvent.change(box(), { target: { value: 'unsent' } })
    first.unmount()
    const other = render(<Composer {...base} draftKey="bot:researcher" />)
    expect(box()).toHaveValue('')
    other.unmount()
    render(<Composer {...base} onSend={onSend} />)
    expect(box()).toHaveValue('unsent')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('unsent')
    cleanup()
    render(<Composer {...base} />)
    expect(box()).toHaveValue('')
  })
})

describe('composerDisabledReason', () => {
  const ok = { hermes: 'connected' as const, crewConnected: true, canSend: true, othersWorking: 0, maxWorkingBots: 2 as number | null }
  it('is null when everything is fine, and one other bot working is allowed', () => {
    expect(composerDisabledReason(ok)).toBeNull()
    expect(composerDisabledReason({ ...ok, othersWorking: 1 })).toBeNull()
  })
  it('allows any number of working bots when the limit is off', () => {
    expect(composerDisabledReason({ ...ok, othersWorking: 9, maxWorkingBots: null })).toBeNull()
  })
  it('holds the composer at the configured limit', () => {
    const reason = composerDisabledReason({ ...ok, othersWorking: 3, maxWorkingBots: 3 })
    expect(reason).toContain('3 bots are working')
    expect(reason).toContain('Settings')
    expect(composerDisabledReason({ ...ok, othersWorking: 2, maxWorkingBots: 3 })).toBeNull()
  })
  it('uses the singular for a limit of one', () => {
    expect(composerDisabledReason({ ...ok, othersWorking: 1, maxWorkingBots: 1 })).toMatch(/^1 bot is working/)
  })
  it('follows the priority order', () => {
    const all = { hermes: 'offline' as const, crewConnected: false, canSend: false, othersWorking: 2, maxWorkingBots: 2 }
    expect(composerDisabledReason(all)).toBe('Hermes is offline')
    expect(composerDisabledReason({ ...all, hermes: 'connected' })).toBe('Reconnecting to Crew…')
    expect(composerDisabledReason({ ...all, hermes: 'connected', crewConnected: true })).toBe('Connecting to the chat…')
    expect(composerDisabledReason({ ...all, hermes: 'connected', crewConnected: true, canSend: true })).toBe('2 bots are working — wait, stop one, or raise the limit in Settings')
  })
})
