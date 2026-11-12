import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GroupComposer } from '@/features/groups/GroupComposer'

import { bot, gm, group } from './fixtures'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: () => <div data-testid="stub" /> }
})

const view = group({ id: 'r1', members: ['crew-test', 'e2e1', 'hermes'].map(gm) })
const members = [bot({ name: 'crew-test', title: 'Crew Test' }), bot({ name: 'e2e1', title: 'E2E One' }), bot({ name: 'hermes', title: 'Hermes' })]
const titleOf = (id: string): string => members.find(b => b.name === id)?.title ?? id

const setup = (over: Partial<Parameters<typeof GroupComposer>[0]> = {}) => {
  const onSend = vi.fn()
  const onStop = vi.fn()
  render(<GroupComposer view={view} members={members} titleOf={titleOf} firstInTopic running={false} disabledReason={null} onSend={onSend} onStop={onStop} {...over} />)
  return { onSend, onStop }
}
const box = () => screen.getByRole('textbox', { name: 'Message' })
const type = (value: string) => {
  fireEvent.change(box(), { target: { value, selectionStart: value.length, selectionEnd: value.length } })
  ;(box() as HTMLTextAreaElement).setSelectionRange(value.length, value.length)
  fireEvent.keyUp(box(), { key: 'x' })
}
const line = () => screen.getByTestId('who-will-answer').textContent

describe('GroupComposer mentions', () => {
  it('has the spec placeholder', () => {
    setup()
    expect(box()).toHaveAttribute('placeholder', 'Message the group. Type @ to mention a bot')
  })

  it('opens the mention list on @ and inserts the handle with a trailing space', () => {
    const { onSend } = setup()
    type('@cr')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('@crew-test')).toBeInTheDocument()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box()).toHaveValue('@crew-test ')
    expect(onSend).not.toHaveBeenCalled()
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('inserts on click and replaces only the query in the middle of the text', () => {
    setup()
    type('hi @e2 there')
    expect(screen.queryByRole('listbox')).toBeNull()
    type('hi @e2')
    fireEvent.click(screen.getByRole('option', { name: /E2E One/ }))
    expect(box()).toHaveValue('hi @e2e1 ')
  })

  it('moves through options with the arrow keys and closes on Escape', () => {
    setup()
    type('@')
    const options = () => screen.getAllByRole('option')
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    expect(box()).toHaveAttribute('aria-activedescendant', options()[0]!.id)
    fireEvent.keyDown(box(), { key: 'ArrowDown' })
    expect(options()[1]).toHaveAttribute('aria-selected', 'true')
    expect(box()).toHaveAttribute('aria-activedescendant', options()[1]!.id)
    fireEvent.keyDown(box(), { key: 'ArrowUp' })
    expect(options()[0]).toHaveAttribute('aria-selected', 'true')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(box()).toHaveValue('@')
  })

  it('reopens after Escape once the message was sent', () => {
    setup()
    type('@')
    fireEvent.keyDown(box(), { key: 'Escape' })
    type('hello')
    fireEvent.keyDown(box(), { key: 'Enter' })
    type('@')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('reopens after Escape when the token is deleted and a new @ is typed', () => {
    setup()
    type('@cr')
    fireEvent.keyDown(box(), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).toBeNull()
    type('')
    type('@')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('stays closed while the same token keeps being typed after Escape', () => {
    setup()
    type('@cr')
    fireEvent.keyDown(box(), { key: 'Escape' })
    type('@cre')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('offers @everyone', () => {
    setup()
    type('@ev')
    fireEvent.keyDown(box(), { key: 'Tab' })
    expect(box()).toHaveValue('@everyone ')
  })

  it('sends on Enter when nothing matches', () => {
    const { onSend } = setup()
    type('@zzz')
    expect(screen.queryByRole('listbox')).toBeNull()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('@zzz', { newTopic: false })
  })
})

describe('GroupComposer shortcuts and actions', () => {
  it('puts the caret in the message box on / from outside a field, and types / inside it', () => {
    setup()
    expect(box()).not.toHaveFocus()
    fireEvent.keyDown(document.body, { key: '/' })
    expect(box()).toHaveFocus()
    // Inside the box the key is text: the shortcut stands down (not prevented).
    expect(fireEvent.keyDown(box(), { key: '/' })).toBe(true)
  })

  it('leaves / alone while sending is blocked', () => {
    setup({ disabledReason: 'Hermes is offline' })
    expect(fireEvent.keyDown(document.body, { key: '/' })).toBe(true)
    expect(box()).not.toHaveFocus()
  })

  it('sends with the Send button, which is off while the box is empty', () => {
    const { onSend } = setup()
    type('')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    type('by button')
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenCalledWith('by button', { newTopic: false })
    expect(box()).toHaveValue('')
  })

  it('keeps the reason and the who-will-answer line in one caption under the box', () => {
    setup({ disabledReason: 'Hermes is offline' })
    const reason = screen.getByRole('status')
    expect(reason).toHaveTextContent('Hermes is offline')
    expect(reason.parentElement).toBe(screen.getByTestId('who-will-answer').parentElement)
  })
})

describe('GroupComposer line', () => {
  it('shows who will answer for a mention, two mentions, a trailing dot, a first message and a follow-up', () => {
    const { rerender } = render(<GroupComposer view={view} members={members} titleOf={titleOf} firstInTopic running={false} disabledReason={null} onSend={vi.fn()} onStop={vi.fn()} />)
    expect(line()).toBe('Auto will pick who replies')
    type('@e2e1 hi')
    expect(line()).toBe('@e2e1 will reply')
    type('@e2e1 @hermes')
    expect(line()).toBe('@e2e1 and @hermes will reply')
    type('@e2e1. hi')
    expect(line()).toBe('Auto will pick who replies')
    rerender(<GroupComposer view={view} members={members} titleOf={titleOf} firstInTopic={false} running={false} disabledReason={null} onSend={vi.fn()} onStop={vi.fn()} />)
    expect(line()).toBe('Everyone (3 bots) will reply · @mention to ask one bot')
  })
})

describe('GroupComposer long topics', () => {
  it('says long topics start fresh when the topic is full, unless New topic is armed', () => {
    setup({ topicFull: true, firstInTopic: false })
    expect(line()).toBe('New topic · Auto will pick who replies — long topics start fresh (Hermes keeps 24 messages per topic)')
    fireEvent.click(screen.getByRole('button', { name: 'New topic' }))
    expect(line()).toBe('New topic · Auto will pick who replies')
  })
})

describe('GroupComposer topics and running', () => {
  it('arms New topic, says so in the line, and sends with newTopic true once', () => {
    const { onSend } = setup({ firstInTopic: false })
    const button = screen.getByRole('button', { name: 'New topic' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(button)
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(line()).toBe('New topic · Auto will pick who replies')
    type('fresh start')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenCalledWith('fresh start', { newTopic: true })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    type('next')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).toHaveBeenLastCalledWith('next', { newTopic: false })
  })

  it('turns Send into Stop while the group works', () => {
    const { onSend, onStop } = setup({ running: true })
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalled()
    type('hi')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('is disabled with the reason shown', () => {
    const { onSend } = setup({ disabledReason: 'Hermes is offline' })
    expect(screen.getByText('Hermes is offline')).toBeInTheDocument()
    expect(box()).toBeDisabled()
    expect(onSend).not.toHaveBeenCalled()
  })

  it('lists a deleted member by handle only', () => {
    setup({ members: [members[0]!] })
    type('@e2')
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(box()).toHaveValue('@e2e1 ')
  })
})
