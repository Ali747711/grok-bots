import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Composer } from '@/features/chat/Composer'
import { composerDisabledReason } from '@/features/chat/disabled-reason'

const base = { onSend: vi.fn(), onStop: vi.fn(), running: false, disabledReason: null as string | null }
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

  it('shows Stop instead of Send while running', () => {
    const onStop = vi.fn()
    render(<Composer {...base} running onStop={onStop} />)
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
  })
})

describe('composerDisabledReason', () => {
  const ok = { hermes: 'connected' as const, crewConnected: true, canSend: true, othersWorking: 0 }
  it('is null when everything is fine, and one other bot working is allowed', () => {
    expect(composerDisabledReason(ok)).toBeNull()
    expect(composerDisabledReason({ ...ok, othersWorking: 1 })).toBeNull()
  })
  it('follows the priority order', () => {
    const all = { hermes: 'offline' as const, crewConnected: false, canSend: false, othersWorking: 2 }
    expect(composerDisabledReason(all)).toBe('Hermes is offline')
    expect(composerDisabledReason({ ...all, hermes: 'connected' })).toBe('Reconnecting to Crew…')
    expect(composerDisabledReason({ ...all, hermes: 'connected', crewConnected: true })).toBe('Connecting to the chat…')
    expect(composerDisabledReason({ ...all, hermes: 'connected', crewConnected: true, canSend: true })).toBe('2 bots are working — wait or stop one')
  })
})
