import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { RequestCard } from '@/features/requests/RequestCard'
import { choiceCopy } from '@/features/requests/choice-copy'
import type { PendingView } from '@/state/types'

const entry = (over: Partial<PendingView> = {}): PendingView => ({
  id: 'p1', kind: 'approval', profile: 'dev', sessionId: 's', summary: 'Delete files — rm -r /tmp/x', choices: ['once', 'deny'],
  receivedAt: 1, source: 'event', state: 'open', answerable: true, ...over
})
const noop = () => Promise.resolve(null)

describe('choiceCopy', () => {
  it('maps the known choices and falls back to the raw choice', () => {
    expect(choiceCopy('once')).toEqual({ label: 'Allow once', hint: 'Just this time' })
    expect(choiceCopy('session')).toEqual({ label: 'Allow for this chat', hint: 'Saves a rule for this kind of command until the chat ends' })
    expect(choiceCopy('always')).toEqual({ label: 'Always allow', hint: 'Saves a permanent rule for this kind of command for this bot' })
    expect(choiceCopy('deny')).toEqual({ label: 'Deny', hint: 'The bot is told no' })
    expect(choiceCopy('weird')).toEqual({ label: 'weird', hint: '' })
  })
})

describe('RequestCard: approval', () => {
  it('renders only the choices hermes offered', () => {
    render(<RequestCard entry={entry()} onAnswer={noop} />)
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Allow once', 'Deny'])
  })

  it('shows the real command and description', () => {
    render(<RequestCard entry={entry()} onAnswer={noop} />)
    expect(screen.getByText('Delete files — rm -r /tmp/x')).toBeInTheDocument()
  })

  it('posts the chosen answer', async () => {
    const onAnswer = vi.fn(noop)
    render(<RequestCard entry={entry()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled())
    expect(onAnswer).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), { choice: 'deny' })
  })

  it('explains session and always scopes in plain text and as a tooltip', () => {
    render(<RequestCard entry={entry({ choices: ['once', 'session', 'always', 'deny'] })} onAnswer={noop} />)
    expect(screen.getByRole('button', { name: 'Always allow' })).toHaveAttribute('title', 'Saves a permanent rule for this kind of command for this bot')
    expect(screen.getByText(/Saves a rule for this kind of command until the chat ends/)).toBeInTheDocument()
    expect(screen.getByText(/Saves a permanent rule for this kind of command for this bot/, { selector: 'p *, p' })).toBeInTheDocument()
  })

  it('shows the message returned by a rejected answer', async () => {
    const onAnswer = vi.fn(() => Promise.resolve('Already answered'))
    render(<RequestCard entry={entry()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'Allow once' }))
    expect(await screen.findByText('Already answered')).toBeInTheDocument()
  })

  it('shows a spinner and disables the buttons while answering', () => {
    render(<RequestCard entry={entry({ state: 'answering' })} onAnswer={noop} />)
    expect(screen.getByText('Sending…')).toBeInTheDocument()
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled()
  })

  it('shows the failure reason in plain words and lets the user try again', () => {
    const { rerender } = render(<RequestCard entry={entry({ state: 'failed', error: 'not_connected' })} onAnswer={noop} />)
    expect(screen.getByText(/Hermes was offline/)).toBeInTheDocument()
    for (const b of screen.getAllByRole('button')) expect(b).toBeEnabled()
    rerender(<RequestCard entry={entry({ state: 'failed', error: 'stale_generation' })} onAnswer={noop} />)
    expect(screen.getByText(/This request is no longer current/)).toBeInTheDocument()
    rerender(<RequestCard entry={entry({ state: 'failed', error: 'odd_code' })} onAnswer={noop} />)
    expect(screen.getByText(/odd_code/)).toBeInTheDocument()
  })

  it('has no controls for a request that cannot be answered here', () => {
    render(<RequestCard entry={entry({ answerable: false })} onAnswer={noop} />)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
    expect(screen.getByText('Delete files — rm -r /tmp/x')).toBeInTheDocument()
    expect(screen.getByText('Answer this in the app that asked')).toBeInTheDocument()
  })
})

describe('RequestCard: approval detail', () => {
  const long = (c: string) => c.repeat(400)

  it('shows a long description and the full command, uncut', () => {
    const description = long('d'), command = `echo ${long('c')} && rm -rf /tmp/x`
    render(<RequestCard entry={entry({ description, command, summary: 'short' })} onAnswer={noop} />)
    expect(screen.getByText(description)).toBeInTheDocument()
    const block = screen.getByTestId('approval-command')
    expect(block.textContent).toBe(command)
    expect(block.className).toContain('whitespace-pre-wrap')
    expect(block.className).toContain('break-all')
    expect(screen.queryByText('short')).toBeNull()
  })

  it('puts the command above the choice buttons', () => {
    render(<RequestCard entry={entry({ command: 'rm -r /tmp/x' })} onAnswer={noop} />)
    const block = screen.getByTestId('approval-command')
    const allow = screen.getByRole('button', { name: 'Allow once' })
    expect(block.compareDocumentPosition(allow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('offers only deny and a warning when the text was truncated', () => {
    render(<RequestCard entry={entry({ command: 'x'.repeat(100), detailTruncated: true, choices: ['once', 'session', 'always', 'deny'] })} onAnswer={noop} />)
    expect(screen.getByText('This command is too long to show in full. Review it in the Hermes app.')).toBeInTheDocument()
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Deny'])
  })

  it('shows the warning and no buttons when truncated and deny is not offered', () => {
    render(<RequestCard entry={entry({ command: 'x', detailTruncated: true, choices: ['once'] })} onAnswer={noop} />)
    expect(screen.getByText(/too long to show in full/)).toBeInTheDocument()
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('falls back to the summary when the server sent no detail fields', () => {
    render(<RequestCard entry={entry()} onAnswer={noop} />)
    expect(screen.getByText('Delete files — rm -r /tmp/x')).toBeInTheDocument()
    expect(screen.queryByTestId('approval-command')).toBeNull()
  })
})

describe('RequestCard: hidden characters in the approval text', () => {
  it('makes a bidi override visible in the command and warns', () => {
    const command = 'echo safe \u202Etxt.sh'
    render(<RequestCard entry={entry({ command })} onAnswer={noop} />)
    expect(screen.getByText('⟨U+202E⟩')).toBeInTheDocument()
    expect(screen.getByText('This command contains hidden characters.')).toBeInTheDocument()
    expect(screen.getByTestId('approval-command').textContent).toContain('echo safe ⟨U+202E⟩txt.sh')
  })

  it.each(['\u2066', '\u200B', '\uFEFF', '\u00AD', '\u061C', '\u2060'])('flags %j', ch => {
    render(<RequestCard entry={entry({ command: `a${ch}b` })} onAnswer={noop} />)
    expect(screen.getByText(/^⟨U\+[0-9A-F]{4}⟩$/)).toBeInTheDocument()
  })

  it('marks hidden characters in the description too', () => {
    render(<RequestCard entry={entry({ description: 'clean\u200Dup', command: 'ls' })} onAnswer={noop} />)
    expect(screen.getByText('⟨U+200D⟩')).toBeInTheDocument()
    expect(screen.getByText('This command contains hidden characters.')).toBeInTheDocument()
  })

  it('shows neither token nor warning for a plain command', () => {
    render(<RequestCard entry={entry({ command: 'ls -la', description: 'List files' })} onAnswer={noop} />)
    expect(screen.queryByText(/⟨U\+/)).toBeNull()
    expect(screen.queryByText(/hidden characters/)).toBeNull()
  })
})

describe('RequestCard: black card', () => {
  it('breaks a long unbroken bot name in the approval title', () => {
    render(<RequestCard entry={entry({ command: 'ls' })} botTitle={'y'.repeat(80)} onAnswer={noop} />)
    expect(screen.getByRole('heading', { level: 3 })).toHaveClass('break-words')
  })

  it('keeps a long command scrollable and hidden characters visible on the black card', () => {
    const command = `echo \u202E${'x'.repeat(5000)}`
    render(<RequestCard entry={entry({ command })} botTitle="Dev" onAnswer={noop} />)
    const card = screen.getByTestId('request-card')
    expect(card).toHaveClass('bg-contrast', 'text-contrast-foreground', 'border-contrast-border')
    expect(within(card).getByText('Needs you')).toHaveClass('label-mono', 'text-primary')
    expect(screen.getByText('Dev needs your approval')).toBeInTheDocument()
    const block = screen.getByTestId('approval-command')
    expect(block).toHaveClass('overflow-auto', 'bg-contrast-muted', 'whitespace-pre-wrap', 'break-all')
    expect(block.textContent).toBe(command.replace('\u202E', '⟨U+202E⟩'))
    expect(screen.getByText('⟨U+202E⟩')).toHaveClass('bg-contrast-danger', 'text-contrast')
    expect(screen.getByText('This command contains hidden characters.')).toHaveClass('text-contrast-danger')
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Allow once', 'Deny'])
  })

  it('makes only Allow once lime and keeps deny-only when detail is truncated', () => {
    const { rerender } = render(<RequestCard entry={entry({ choices: ['session', 'once', 'deny'] })} onAnswer={noop} />)
    expect(screen.getByRole('button', { name: 'Allow once' })).toHaveClass('bg-primary')
    for (const name of ['Allow for this chat', 'Deny']) {
      const b = screen.getByRole('button', { name })
      expect(b).toHaveClass('border-contrast-line', 'text-contrast-foreground')
      expect(b.className).not.toMatch(/bg-primary|dark:bg-input/)
    }
    rerender(<RequestCard entry={entry({ command: 'x', detailTruncated: true, choices: ['once', 'deny'] })} onAnswer={noop} />)
    expect(screen.getAllByRole('button').map(b => b.textContent)).toEqual(['Deny'])
    expect(screen.getByText(/too long to show in full/)).toHaveClass('text-contrast-danger')
    rerender(<RequestCard entry={entry({ choices: ['mystery', 'once', 'deny'] })} onAnswer={noop} />)
    expect(screen.getByRole('button', { name: 'mystery' })).not.toHaveClass('bg-primary')
    expect(screen.getByRole('button', { name: 'Allow once' })).toHaveClass('bg-primary')
    rerender(<RequestCard entry={entry({ state: 'failed', error: 'not_connected' })} onAnswer={noop} />)
    expect(screen.getByText(/Couldn’t send/)).toHaveClass('text-contrast-danger')
  })

  it('puts clarify and secret inputs on the dark muted fill', () => {
    const { rerender } = render(<RequestCard entry={entry({ kind: 'clarify', summary: 'Which?', choices: undefined })} onAnswer={noop} />)
    expect(screen.getByLabelText('Your answer')).toHaveClass('bg-contrast-muted', 'dark:bg-contrast-muted', 'border-contrast-line')
    rerender(<RequestCard entry={entry({ kind: 'secret', summary: 'Key', choices: undefined })} onAnswer={noop} />)
    expect(screen.getByLabelText('Key')).toHaveClass('bg-contrast-muted')
  })
})

describe('RequestCard: clarify', () => {
  const clarify = (over: Partial<PendingView> = {}) => entry({ kind: 'clarify', summary: 'Which branch?', choices: ['main', 'dev'], ...over })

  it('sends a clicked choice', async () => {
    const onAnswer = vi.fn(noop)
    render(<RequestCard entry={clarify()} onAnswer={onAnswer} />)
    fireEvent.click(screen.getByRole('button', { name: 'dev' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'dev' })).toBeEnabled())
    expect(onAnswer).toHaveBeenCalledWith(expect.anything(), { answer: 'dev' })
  })

  it('sends free text, and an empty skip', async () => {
    const onAnswer = vi.fn(noop)
    render(<RequestCard entry={clarify({ choices: undefined })} onAnswer={onAnswer} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'release' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onAnswer).toHaveBeenLastCalledWith(expect.anything(), { answer: 'release' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }))
    expect(onAnswer).toHaveBeenLastCalledWith(expect.anything(), { answer: '' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Skip' })).toBeEnabled())
  })
})

describe('RequestCard: secret and sudo', () => {
  it('uses a masked input labelled by kind, clears it after submit and never keeps the value', async () => {
    const onAnswer = vi.fn(noop)
    render(<RequestCard entry={entry({ kind: 'sudo', summary: 'apt update', choices: undefined })} onAnswer={onAnswer} />)
    expect(screen.getByText('Password needed to run: apt update')).toBeInTheDocument()
    const input = screen.getByLabelText(/Password needed/) as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.autocomplete).toBe('off')
    fireEvent.change(input, { target: { value: 'hunter2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onAnswer).toHaveBeenCalledWith(expect.anything(), { value: 'hunter2' })
    await waitFor(() => expect(input.value).toBe(''))
    expect(document.body.innerHTML).not.toContain('hunter2')
  })

  it('clears the value even when the answer is rejected', async () => {
    const onAnswer = vi.fn(() => Promise.resolve('Hermes is offline — try again when it’s back'))
    render(<RequestCard entry={entry({ kind: 'secret', summary: 'API key for X', choices: undefined })} onAnswer={onAnswer} />)
    const input = screen.getByLabelText('API key for X') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'sekret' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(await screen.findByText(/Hermes is offline/)).toBeInTheDocument()
    expect(input.value).toBe('')
    expect(document.body.innerHTML).not.toContain('sekret')
  })
})

describe('RequestCard: input safety', () => {
  const clarify = entry({ kind: 'clarify', summary: 'Which?', choices: undefined })
  const secret = entry({ kind: 'secret', summary: 'API key for X', choices: undefined })

  it.each([
    ['isComposing', { key: 'Enter', isComposing: true }],
    ['keyCode 229', { key: 'Enter', keyCode: 229 }]
  ])('does not submit a clarify answer on Enter during IME composition (%s)', (_name, init) => {
    const onAnswer = vi.fn(noop)
    render(<RequestCard entry={clarify} onAnswer={onAnswer} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '안녕' } })
    fireEvent.keyDown(input, init)
    expect(onAnswer).not.toHaveBeenCalled()
    expect(input).toHaveValue('안녕')
  })

  it('does not submit a secret on Enter during IME composition', () => {
    const onAnswer = vi.fn(noop)
    render(<RequestCard entry={secret} onAnswer={onAnswer} />)
    const input = screen.getByLabelText('API key for X')
    fireEvent.change(input, { target: { value: 'abc' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it('keeps the clarify text when the answer is rejected, and clears it once accepted', async () => {
    const onAnswer = vi.fn<(e: PendingView, b: unknown) => Promise<string | null>>()
    onAnswer.mockResolvedValueOnce('Hermes is offline — try again when it’s back').mockResolvedValueOnce(null)
    render(<RequestCard entry={clarify} onAnswer={onAnswer} />)
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'release branch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(await screen.findByText(/Hermes is offline/)).toBeInTheDocument()
    expect(input).toHaveValue('release branch')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    await waitFor(() => expect(input).toHaveValue(''))
  })

  it('limits clarify text to 4000 characters and shows the count near the limit', () => {
    render(<RequestCard entry={clarify} onAnswer={noop} />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    expect(input.maxLength).toBe(4000)
    fireEvent.change(input, { target: { value: 'x'.repeat(4001) } })
    expect(input.value).toHaveLength(4000)
    expect(screen.getByText('4,000 / 4,000')).toBeInTheDocument()
  })

  it('shows no count for short text', () => {
    render(<RequestCard entry={clarify} onAnswer={noop} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hi' } })
    expect(screen.queryByText(/ \/ 4,000/)).toBeNull()
  })

  it('still shows the summary for a secret request that cannot be answered here', () => {
    render(<RequestCard entry={{ ...secret, answerable: false }} onAnswer={noop} />)
    expect(screen.getByText('API key for X')).toBeInTheDocument()
    expect(screen.getByText('Answer this in the app that asked')).toBeInTheDocument()
  })
})
