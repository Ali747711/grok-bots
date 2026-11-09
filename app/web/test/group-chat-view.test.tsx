import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CrewState, GroupEvent, GroupView, PendingView } from '@/state/types'

import { bot, crewState, gm, group } from './fixtures'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-state={String(props.state)} /> }
})
const api = vi.hoisted(() => ({
  fetchGroupEvents: vi.fn(), sendGroupMessage: vi.fn(), stopGroup: vi.fn(), continueGroup: vi.fn(), retryTurn: vi.fn(), discardTurn: vi.fn()
}))
vi.mock('@/features/groups/groups-api', () => api)

const { GroupChatView } = await import('@/features/groups/GroupChatView')

const ev = (seq: number, over: Partial<GroupEvent> = {}): GroupEvent => ({
  seq, eventId: `e${seq}`, kind: 'message.member', createdAt: seq, actor: { kind: 'member', id: 'reese', profile: 'reese', displayName: null }, text: 'hi', threadId: 't1', memberId: 'reese', ...over
})
const bots = [bot({ name: 'reese', title: 'Reese', status: 'working' }), bot({ name: 'x', title: 'X' }), bot({ name: 'other', title: 'Other' })]
const room = (over: Partial<GroupView> = {}) => group({ id: 'r1', name: 'Launch', members: [gm('reese'), gm('x')], latestSeq: 2, ...over })
const state = (r: GroupView | null, over: Partial<CrewState> = {}) =>
  crewState({ bots, groups: { available: true, seatable: ['reese', 'x'], rooms: r ? [r] : [] }, ...over })
const mount = (st: CrewState, crewConnected = true) =>
  render(<MemoryRouter><GroupChatView state={st} crewConnected={crewConnected} roomId="r1" panelOpen={false} onPanel={vi.fn()} /></MemoryRouter>)

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  api.fetchGroupEvents.mockResolvedValue({ events: [ev(1, { text: 'Done, @x take over' })], cursor: 1, latestSeq: 1, hasMore: false, epoch: 1 })
  api.stopGroup.mockResolvedValue({ cancelled: true })
})

describe('GroupChatView', () => {
  it('shows the header and member replies with avatar, title and handle', async () => {
    mount(state(room()))
    expect(screen.getByRole('heading', { name: 'Launch' })).toBeInTheDocument()
    expect(screen.getByText('2 bots · Auto replies')).toBeInTheDocument()
    const reply = await screen.findByTestId('member-message')
    expect(within(reply).getByText('Reese')).toBeInTheDocument()
    expect(within(reply).getByText('@reese')).toBeInTheDocument()
    expect(within(reply).getByTestId('stub')).toHaveAttribute('data-state', expect.not.stringMatching(/working/))
  })

  it('highlights only mentions Hermes would route', async () => {
    api.fetchGroupEvents.mockResolvedValue({ events: [ev(1, { text: 'ask @x and @ghost, also @x.' })], cursor: 1, latestSeq: 1, hasMore: false, epoch: 1 })
    mount(state(room()))
    const reply = await screen.findByTestId('member-message')
    const marks = [...reply.querySelectorAll('.bg-sky-soft')].map(n => n.textContent)
    expect(marks).toEqual(['@x'])
    expect(reply.textContent).toContain('@ghost')
  })

  it('shows live rows for running, stalled and queued members', async () => {
    mount(state(room({ working: true, activity: [
      { memberId: 'reese', status: 'running', tool: 'search', stalled: false },
      { memberId: 'x', status: 'queued', tool: null, stalled: false }
    ] })))
    expect(await screen.findByText('Reese is using search…')).toBeInTheDocument()
    expect(screen.getByText('Up next: X')).toBeInTheDocument()
  })

  it('shows a stalled and a plain working row', async () => {
    mount(state(room({ working: true, activity: [
      { memberId: 'reese', status: 'running', tool: null, stalled: true },
      { memberId: 'x', status: 'running', tool: null, stalled: false }
    ] })))
    expect(await screen.findByText('Reese seems stuck')).toBeInTheDocument()
    expect(screen.getByText('X is working…')).toBeInTheDocument()
  })

  it('shows Stop while the group works and calls stop', async () => {
    mount(state(room({ working: true })))
    fireEvent.click((await screen.findAllByRole('button', { name: 'Stop' }))[0]!)
    await waitFor(() => expect(api.stopGroup).toHaveBeenCalledWith('r1', expect.any(String)))
  })

  it('hides Stop when idle', async () => {
    mount(state(room()))
    await screen.findByTestId('member-message')
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  it('shows group approval cards for this room only', async () => {
    const mk = (id: string, roomId: string, source: PendingView['source'] = 'group'): PendingView => ({
      id, kind: 'approval', profile: 'reese', sessionId: 's', summary: `cmd ${id}`, choices: ['once', 'deny'], receivedAt: 1, source,
      state: 'open', answerable: true, group: { roomId, memberId: 'reese', taskId: 't', requestId: id }
    })
    mount(state(room(), { pending: [mk('mine', 'r1'), mk('theirs', 'r2')] }))
    const cards = await screen.findAllByTestId('request-card')
    expect(cards).toHaveLength(1)
    expect(cards[0]).toHaveTextContent('cmd mine')
    expect(cards[0]).toHaveTextContent('Reese')
    expect(within(cards[0]!).getByRole('button', { name: 'Allow once' })).toBeInTheDocument()
  })

  it('calls Keep going and the turn actions', async () => {
    api.fetchGroupEvents.mockResolvedValue({ events: [ev(1, { kind: 'room.activity', status: 'bounded', reasonCode: 'max_rounds', discussionEventId: 'd1', text: undefined })], cursor: 1, latestSeq: 1, hasMore: false, epoch: 1 })
    api.continueGroup.mockResolvedValue(undefined)
    api.retryTurn.mockResolvedValue(undefined)
    api.discardTurn.mockResolvedValue(undefined)
    mount(state(room({ turnActions: [
      { memberId: 'x', kind: 'retry', taskId: 't', executionGeneration: 1 },
      { memberId: 'x', kind: 'discard', taskId: 't', executionGeneration: 1 }
    ] })))
    fireEvent.click(await screen.findByRole('button', { name: 'Keep going' }))
    expect(api.continueGroup).toHaveBeenCalledWith('r1', 'd1')
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(api.retryTurn).toHaveBeenCalledWith('r1', { memberId: 'x', taskId: 't', executionGeneration: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(api.discardTurn).toHaveBeenCalled()
  })

  it('says older messages are in Hermes when history was cut', async () => {
    api.fetchGroupEvents.mockResolvedValue({ events: [ev(501)], cursor: 501, latestSeq: 501, hasMore: false, epoch: 1 })
    mount(state(room({ latestSeq: 501 })))
    expect(await screen.findByText('Older messages are in Hermes.')).toBeInTheDocument()
  })

  it('shows an error with Try again after a failed fetch', async () => {
    api.fetchGroupEvents.mockRejectedValueOnce(new Error('Hermes is offline'))
    mount(state(room()))
    expect(await screen.findByText('Hermes is offline', { selector: 'p[data-testid="room-error"]' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByTestId('member-message')).toBeInTheDocument()
    expect(screen.queryByTestId('room-error')).toBeNull()
  })

  it('hides Stop in the composer and header while stale', async () => {
    mount(state(room({ working: true })), false)
    await screen.findByTestId('member-message')
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  it('shows the stuck banner and recovers with Stop and a new topic', async () => {
    api.sendGroupMessage.mockResolvedValue({ kind: 'accepted', seq: 3 })
    api.fetchGroupEvents.mockResolvedValue({ events: [ev(1, { kind: 'message.user', text: 'start', memberId: undefined, actor: { kind: 'user', id: 'desktop', profile: null, displayName: null } }), ev(2)], cursor: 2, latestSeq: 2, hasMore: false, epoch: 1 })
    mount(state(room({ stuck: true })))
    expect(await screen.findByText('This group is stuck in Hermes: one topic grew past the 24 messages Hermes can track.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop and start a new topic' }))
    await waitFor(() => expect(api.stopGroup).toHaveBeenCalledWith('r1', expect.any(String)))
    await waitFor(() => expect(screen.getByRole('button', { name: 'New topic' })).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'fresh' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' })
    await waitFor(() => expect(api.sendGroupMessage).toHaveBeenCalled())
    expect(api.sendGroupMessage.mock.calls[0]![1].threadId).toBeUndefined()
  })

  it('hides the stuck banner when the group is healthy', async () => {
    mount(state(room()))
    await screen.findByTestId('member-message')
    expect(screen.queryByText(/stuck in Hermes/)).toBeNull()
  })

  it('disables the composer while Hermes is offline', async () => {
    mount(state(room(), { hermes: 'offline' }))
    expect(await screen.findByText('Hermes is offline')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled()
  })

  it('sends from the composer on the current topic', async () => {
    api.sendGroupMessage.mockResolvedValue({ kind: 'accepted', seq: 3 })
    api.fetchGroupEvents.mockResolvedValue({ events: [ev(1, { kind: 'message.user', text: 'start', memberId: undefined, actor: { kind: 'user', id: 'desktop', profile: null, displayName: null } }), ev(2)], cursor: 2, latestSeq: 2, hasMore: false, epoch: 1 })
    mount(state(room()))
    await screen.findByTestId('member-message')
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'go' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' })
    await waitFor(() => expect(api.sendGroupMessage).toHaveBeenCalledWith('r1', expect.objectContaining({ text: 'go', threadId: 't1' })))
  })

  it('goes to the not-found pattern when the group disappears', async () => {
    const { rerender } = mount(state(room()))
    await screen.findByTestId('member-message')
    await act(async () => {
      rerender(<MemoryRouter><GroupChatView state={state(null)} crewConnected roomId="r1" panelOpen={false} onPanel={vi.fn()} /></MemoryRouter>)
    })
    expect(screen.getByText('Group not found')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your bots' })).toBeInTheDocument()
  })
})
