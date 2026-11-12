import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { GroupView } from '@/state/types'

import { bot, gm, group } from './fixtures'
import { pickOption } from './select-helpers'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-state={String(props.state)} /> }
})
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
const api = vi.hoisted(() => ({ renameGroup: vi.fn(), setGroupContext: vi.fn(), deleteGroup: vi.fn() }))
vi.mock('@/features/groups/groups-api', async () => ({ ...(await vi.importActual<object>('@/features/groups/groups-api')), ...api }))

const { GroupPanel } = await import('@/features/groups/GroupPanel')
const { GroupApiError } = await import('@/features/groups/groups-api')

const bots = [bot({ name: 'reese', title: 'Reese', status: 'working' }), bot({ name: 'x', title: 'X' })]
const view = (over: Partial<GroupView> = {}) => group({ id: 'r1', name: 'Launch', members: [gm('reese'), gm('x'), gm('gone')], purpose: 'old purpose', notes: 'old notes', ...over })
const setup = (v = view(), stale = false) => {
  const onDeleted = vi.fn()
  const ui = (g: GroupView) => <MemoryRouter><GroupPanel view={g} bots={bots} stale={stale} onDeleted={onDeleted} /></MemoryRouter>
  const r = render(ui(v))
  return { onDeleted, rerender: (g: GroupView) => r.rerender(ui(g)) }
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset()
  toast.success.mockReset()
  api.renameGroup.mockResolvedValue({ name: 'New' })
  api.setGroupContext.mockResolvedValue({})
})

describe('GroupPanel', () => {
  it('renames the group', async () => {
    setup()
    const save = screen.getByRole('button', { name: 'Rename' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: '  New  ' } })
    expect(save).toBeEnabled()
    fireEvent.click(save)
    await waitFor(() => expect(api.renameGroup).toHaveBeenCalledWith('r1', 'New'))
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
  })

  it('saves the reply rule with purpose and notes', async () => {
    setup()
    const save = screen.getByRole('button', { name: 'Save' })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: /Everyone/ }))
    fireEvent.change(screen.getByLabelText('What this group is for'), { target: { value: 'ship' } })
    fireEvent.change(screen.getByLabelText('Notes for the bots'), { target: { value: 'be brief' } })
    expect(screen.getByText('4 / 500')).toBeInTheDocument()
    fireEvent.click(save)
    await waitFor(() => expect(api.setGroupContext).toHaveBeenCalledWith('r1', { routing: 'everyone', purpose: 'ship', notes: 'be brief' }))
    expect(toast.success).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('shows the rule copy', () => {
    setup()
    expect(screen.getByText('Who answers when nobody is @mentioned')).toBeInTheDocument()
    expect(screen.getByText('A quick check picks who answers')).toBeInTheDocument()
    expect(screen.getByText('Every bot answers')).toBeInTheDocument()
    expect(screen.getByText('A lead bot decides who answers')).toBeInTheDocument()
    expect(screen.getByText('@mentions always go straight to the bots you name.')).toBeInTheDocument()
  })

  it('offers the three rules as one named radio group', () => {
    setup()
    const rules = screen.getByRole('radiogroup', { name: 'Who answers when nobody is @mentioned' })
    expect(screen.queryByRole('radiogroup', { name: 'Reply rule' })).toBeNull()
    expect(within(rules).getAllByRole('radio')).toHaveLength(3)
    // groups.spec clicks the radios themselves: each one covers its row instead of hiding off-screen.
    for (const radio of within(rules).getAllByRole('radio')) expect(radio).not.toHaveClass('sr-only')
    expect(within(rules).getByRole('radio', { name: /Auto/ })).toBeChecked()
    fireEvent.click(within(rules).getByRole('radio', { name: /Lead/ }))
    expect(within(rules).getByRole('radio', { name: /Lead/ })).toBeChecked()
    expect(within(rules).getByRole('radio', { name: /Auto/ })).not.toBeChecked()
  })

  it('titles the panel and closes it with Close panel', () => {
    const onClose = vi.fn()
    render(<MemoryRouter><GroupPanel view={view()} bots={bots} stale={false} onDeleted={vi.fn()} onClose={onClose} /></MemoryRouter>)
    expect(screen.getByRole('heading', { name: 'Group details', level: 2 })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close panel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('says what deleting removes beside the Delete group button', () => {
    setup()
    const zone = screen.getByRole('heading', { name: 'Danger zone' }).closest('section')!
    expect(within(zone).getByText('Removes the group and its chat. The bots stay.')).toBeInTheDocument()
    expect(within(zone).getByRole('button', { name: 'Delete group' })).toBeInTheDocument()
  })

  it('requires a lead for Lead and sends it', async () => {
    setup()
    fireEvent.click(screen.getByRole('radio', { name: /Lead/ }))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    pickOption('Lead bot', 'X')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.setGroupContext).toHaveBeenCalledWith('r1', { routing: 'lead', leadMemberId: 'x', purpose: 'old purpose', notes: 'old notes' }))
  })

  it('shows members as fixed with links to their chats', () => {
    setup()
    expect(screen.getByText('Members are set when the group is created. To change them, make a new group.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Reese/ })).toHaveAttribute('href', '/bots/reese')
    expect(screen.getByRole('link', { name: /Reese/ })).toHaveTextContent('@reese')
    expect(screen.getByText('Deleted bot')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Deleted bot/ })).toBeNull()
  })

  it('shows member status while connected', () => {
    setup()
    expect(screen.getByText('Working')).toBeInTheDocument()
    expect(screen.getAllByTestId('stub').some(s => s.getAttribute('data-state') === 'working')).toBe(true)
  })

  it('keeps member statuses neutral while stale', () => {
    setup(view(), true)
    expect(screen.queryByText('Working')).toBeNull()
    expect(screen.queryByText('Idle')).toBeNull()
    for (const s of screen.getAllByTestId('stub')) expect(s).not.toHaveAttribute('data-state', 'working')
  })

  it('re-reads the view only while there are no unsaved edits', () => {
    const { rerender } = setup()
    rerender(view({ purpose: 'server purpose' }))
    expect(screen.getByLabelText('What this group is for')).toHaveValue('server purpose')
    fireEvent.change(screen.getByLabelText('What this group is for'), { target: { value: 'mine' } })
    rerender(view({ purpose: 'newer' }))
    expect(screen.getByLabelText('What this group is for')).toHaveValue('mine')
  })

  it('deletes after confirming and goes home', async () => {
    api.deleteGroup.mockResolvedValue(undefined)
    const { onDeleted } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(within(dialog).getByText('Delete “Launch”?')).toBeInTheDocument()
    expect(within(dialog).getByText('The group and its chat are removed from Crew and Hermes. The bots stay.')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete group' }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalled())
    expect(api.deleteGroup).toHaveBeenCalledWith('r1')
  })

  it('shows the still-stopping message on 409', async () => {
    api.deleteGroup.mockRejectedValue(new GroupApiError(409, 'still_stopping', 'x'))
    const { onDeleted } = setup()
    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }))
    const dialog = await screen.findByRole('alertdialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete group' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Still stopping. Try again in a moment.')
    expect(onDeleted).not.toHaveBeenCalled()
  })
})
