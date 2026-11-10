import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Composer } from '@/features/chat/Composer'
import { composerCaption } from '@/features/chat/composer-caption'
import { composerDisabledReason } from '@/features/chat/disabled-reason'

const base = { draftKey: 'bot:dev', onSend: vi.fn(), onStop: vi.fn(), running: false, disabledReason: null as string | null, waitingAbove: false, queued: false }
const box = () => screen.getByRole('textbox', { name: 'Message' })

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

  it('shows the disabled reason first, then Waiting for you above, then the queued note', () => {
    const { rerender } = render(<Composer {...base} disabledReason="Hermes is offline" waitingAbove queued />)
    expect(screen.getByRole('status')).toHaveTextContent('Hermes is offline')
    rerender(<Composer {...base} waitingAbove queued />)
    expect(screen.getByRole('status')).toHaveTextContent('Waiting for you above')
    expect(box()).toBeEnabled()
    rerender(<Composer {...base} queued />)
    expect(screen.getByRole('status')).toHaveTextContent('Queued. It goes in after the current turn.')
    rerender(<Composer {...base} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('Enter sends, Shift+Enter adds a line and composition never sends', () => {
    const onSend = vi.fn()
    render(<Composer {...base} onSend={onSend} />)
    fireEvent.change(box(), { target: { value: '안녕' } })
    expect(fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true })).toBe(true)
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true })
    fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 })
    expect(onSend).not.toHaveBeenCalled()
    expect(box()).toHaveValue('안녕')
    // A handled Enter is cancelled, so it never adds a line.
    expect(fireEvent.keyDown(box(), { key: 'Enter' })).toBe(false)
    expect(onSend).toHaveBeenCalledExactlyOnceWith('안녕')
  })

  it('/ focuses the composer except from a field or the live view', () => {
    render(
      <>
        <input aria-label="Other field" />
        <div data-testid="live-view"><button type="button">Screen</button></div>
        <Composer {...base} />
      </>
    )
    fireEvent.keyDown(screen.getByLabelText('Other field'), { key: '/' })
    expect(box()).not.toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Screen' }), { key: '/' })
    expect(box()).not.toHaveFocus()
    fireEvent.keyDown(document.body, { key: '/', ctrlKey: true })
    expect(box()).not.toHaveFocus()
    // Cancelled, so the slash is not typed into the box it just focused.
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(false)
    expect(box()).toHaveFocus()
  })

  it('shows Stop while running and Send otherwise, both by name', () => {
    const onStop = vi.fn()
    const { rerender } = render(<Composer {...base} onStop={onStop} />)
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
    fireEvent.change(box(), { target: { value: 'hi' } })
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
    rerender(<Composer {...base} onStop={onStop} running stopDisabled />)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()
    rerender(<Composer {...base} onStop={onStop} running />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledOnce()
    // Stop goes away when the turn ends, so focus is kept in the box.
    expect(box()).toHaveFocus()
  })

  it('sends from the Send button', () => {
    const onSend = vi.fn()
    render(<Composer {...base} onSend={onSend} />)
    fireEvent.change(box(), { target: { value: ' hello ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledExactlyOnceWith('hello')
    expect(box()).toHaveValue('')
  })

  it('keeps the draft for its key across remounts', () => {
    const first = render(<Composer {...base} draftKey="bot:a" />)
    fireEvent.change(box(), { target: { value: 'for a' } })
    first.unmount()
    const second = render(<Composer {...base} draftKey="bot:b" />)
    expect(box()).toHaveValue('')
    second.unmount()
    render(<Composer {...base} draftKey="bot:a" />)
    expect(box()).toHaveValue('for a')
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

describe('composerCaption', () => {
  it('picks the disabled reason, then the open request, then the queued note', () => {
    expect(composerCaption({ disabledReason: 'Hermes is offline', waitingAbove: true, queued: true })).toBe('Hermes is offline')
    expect(composerCaption({ disabledReason: null, waitingAbove: true, queued: true })).toBe('Waiting for you above')
    expect(composerCaption({ disabledReason: null, waitingAbove: false, queued: true })).toBe('Queued. It goes in after the current turn.')
    expect(composerCaption({ disabledReason: null, waitingAbove: false, queued: false })).toBeNull()
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
