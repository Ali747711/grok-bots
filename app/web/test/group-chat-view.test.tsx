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
    const marks = [...reply.querySelectorAll('mark')]
    expect(marks.map(n => n.textContent)).toEqual(['@x'])
    expect(marks[0]).toHaveClass('bg-raised', 'text-foreground')
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
    mount(state(room({ stuck: true, stuckReason: 'topic_limit' })))
    expect(await screen.findByText('This group is stuck in Hermes: one topic grew past the 24 messages Hermes can track.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Stop and start a new topic' }))
    await waitFor(() => expect(api.stopGroup).toHaveBeenCalledWith('r1', expect.any(String)))
    await waitFor(() => expect(screen.getByRole('button', { name: 'New topic' })).toHaveAttribute('aria-pressed', 'true'))
    fireEvent.change(screen.getByRole('textbox', { name: 'Message' }), { target: { value: 'fresh' } })
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Message' }), { key: 'Enter' })
    await waitFor(() => expect(api.sendGroupMessage).toHaveBeenCalled())
    expect(api.sendGroupMessage.mock.calls[0]![1].threadId).toBeUndefined()
  })

  it('shows the prepare banner with the error and retries through prepareRetry', async () => {
    api.retryTurn.mockResolvedValue(undefined)
    const prepareRetry = { memberId: 'reese, x', taskId: 'prepare:r1', executionGeneration: 3 }
    mount(state(room({ stuck: true, stuckReason: 'prepare_failed', lastError: 'profile gone', prepareRetry })))
    expect(await screen.findByText("Hermes can't start this group's next turn: profile gone")).toBeInTheDocument()
    expect(screen.queryByText(/24 messages/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Stop and start a new topic' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(api.retryTurn).toHaveBeenCalledWith('r1', prepareRetry))
  })

  it('disables the prepare retry while the group is working', async () => {
    const prepareRetry = { memberId: 'reese, x', taskId: 'prepare:r1', executionGeneration: 3 }
    mount(state(room({ stuck: true, stuckReason: 'prepare_failed', lastError: 'x', prepareRetry, working: true })))
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeDisabled()
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

  it('names the transcript as the Messages log, like a bot conversation', async () => {
    mount(state(room()))
    await screen.findByTestId('member-message')
    expect(screen.getByRole('log', { name: 'Messages' })).toBe(screen.getByTestId('transcript'))
  })

  it('shows who is in the group while it has no messages, and not before the log has loaded', async () => {
    let deliver: (log: unknown) => void = () => undefined
    api.fetchGroupEvents.mockReturnValue(new Promise(resolve => { deliver = resolve }))
    mount(state(room({ latestSeq: 0 })))
    expect(screen.queryByText('Start with Launch')).toBeNull()
    await act(async () => { deliver({ events: [], cursor: 0, latestSeq: 0, hasMore: false, epoch: 1 }) })
    expect(await screen.findByText('Start with Launch')).toBeInTheDocument()
    expect(screen.getByText('Reese and X are here. Type @ to ask one of them.')).toBeInTheDocument()
  })

  it('keeps showing who is in the group while the log holds only notices (a new group starts with one)', async () => {
    api.fetchGroupEvents.mockResolvedValue({ events: [ev(1, { kind: 'room.context_set', routing: 'auto', text: undefined, memberId: undefined })], cursor: 1, latestSeq: 1, hasMore: false, epoch: 1 })
    mount(state(room({ latestSeq: 1 })))
    expect(await screen.findByText('Replies set to Auto')).toBeInTheDocument()
    expect(screen.getByText('Start with Launch')).toBeInTheDocument()
  })

  it('does not call the group empty when its log failed to load, and shows the error', async () => {
    api.fetchGroupEvents.mockRejectedValue(new Error('Hermes did not answer'))
    mount(state(room({ latestSeq: 5 })))
    expect(await screen.findByTestId('room-error')).toHaveTextContent('Hermes did not answer')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Start with Launch')).toBeNull()
  })

  it('does not call the group empty when older messages were cut and only notices are loaded', async () => {
    api.fetchGroupEvents.mockResolvedValue({ events: [ev(301, { kind: 'room.context_set', routing: 'auto', text: undefined, memberId: undefined })], cursor: 301, latestSeq: 301, hasMore: false, epoch: 1 })
    mount(state(room({ latestSeq: 301 })))
    expect(await screen.findByText('Replies set to Auto')).toBeInTheDocument()
    expect(screen.getByText('Older messages are in Hermes.')).toBeInTheDocument()
    expect(screen.queryByText('Start with Launch')).toBeNull()
  })

  it('opens the details from the header button, which says whether they are open', async () => {
    const onPanel = vi.fn()
    const { rerender } = render(<MemoryRouter><GroupChatView state={state(room())} crewConnected roomId="r1" panelOpen={false} onPanel={onPanel} /></MemoryRouter>)
    await screen.findByTestId('member-message')
    const header = screen.getByRole('heading', { name: 'Launch' }).closest('header')!
    const details = within(header).getByRole('button', { name: 'Details' })
    expect(details).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(details)
    expect(onPanel).toHaveBeenCalledTimes(1)
    rerender(<MemoryRouter><GroupChatView state={state(room())} crewConnected roomId="r1" panelOpen onPanel={onPanel} /></MemoryRouter>)
    expect(within(header).getByRole('button', { name: 'Details' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows a Working chip in the header only while the group works and the status is current', async () => {
    const chip = (): HTMLElement | null => within(screen.getByRole('heading', { name: 'Launch' }).closest('header')!).queryByText('Working')
    const shown = async (st: CrewState, crewConnected = true): Promise<boolean> => {
      const { unmount } = mount(st, crewConnected)
      await screen.findByTestId('member-message')
      const found = chip() !== null
      unmount()
      return found
    }
    expect(await shown(state(room({ working: true })))).toBe(true)
    expect(await shown(state(room({ working: true })), false)).toBe(false)
    expect(await shown(state(room()))).toBe(false)
  })

  it('never puts destructive text on a tinted fill: a failed reply and the stuck banner are neutral with an error dot', async () => {
    api.fetchGroupEvents.mockResolvedValue({ events: [ev(1, { kind: 'turn.failed', text: undefined, error: 'no credit' })], cursor: 1, latestSeq: 1, hasMore: false, epoch: 1 })
    mount(state(room({ stuck: true, stuckReason: 'topic_limit' })))
    const notice = (await screen.findByText(/couldn't reply: no credit/)).closest('p')!
    const banner = screen.getByRole('alert')
    for (const el of [notice, banner]) {
      expect(el).not.toHaveClass('text-destructive')
      expect(el.querySelector('.bg-status-error')).not.toBeNull()
    }
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
