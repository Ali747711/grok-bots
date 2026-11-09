import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { GroupsSection } from '@/features/groups/GroupsSection'
import { Sidebar } from '@/features/roster/Sidebar'
import type { GroupsState, GroupView } from '@/state/types'

import { bot, crewState, gm, group } from './fixtures'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-state={String(props.state)} /> }
})

const bots = [bot({ name: 'default', title: 'Hermes', isPrimary: true }), bot({ name: 'reese', title: 'Reese', status: 'working' }), bot({ name: 'x', title: 'X' })]
const withGroups = (rooms: GroupView[], over: Partial<GroupsState> = {}) =>
  crewState({ bots, groups: { available: true, seatable: ['reese', 'x'], rooms, ...over } })
const room = (over: Partial<GroupView> = {}) => group({ id: 'r1', name: 'Launch', members: [gm('reese'), gm('x')], ...over })
const renderSection = (state = withGroups([room()]), stale = false, onSelect = vi.fn(), onNewGroup = vi.fn()) => {
  render(<GroupsSection state={state} selectedGroupId={null} stale={stale} onSelect={onSelect} onNewGroup={onNewGroup} />)
  return { onSelect, onNewGroup }
}

describe('GroupsSection', () => {
  it('lists groups after bots with stacked avatars and a preview', () => {
    const state = withGroups([room({ preview: { speaker: { kind: 'user' }, text: 'ship it' } })])
    const { onSelect } = renderSection(state)
    const row = screen.getByRole('button', { name: /Launch/ })
    expect(within(row).getAllByTestId('stub')).toHaveLength(2)
    expect(within(row).getByText('You: ship it')).toBeInTheDocument()
    fireEvent.click(row)
    expect(onSelect).toHaveBeenCalledWith('r1')
  })

  it('previews a member and falls back to member titles', () => {
    renderSection(withGroups([room({ preview: { speaker: { kind: 'member', memberId: 'x' }, text: 'done' } }), room({ id: 'r2', name: 'Two' })]))
    expect(screen.getByText('X: done')).toBeInTheDocument()
    expect(screen.getByText('Reese, X')).toBeInTheDocument()
  })

  it('shows "<Title> is working…" while a member runs', () => {
    renderSection(withGroups([room({ working: true, activity: [{ memberId: 'reese', status: 'running', tool: null, stalled: false }] })]))
    expect(screen.getByText('Reese is working…')).toBeInTheDocument()
  })

  it('shows a deleted member as a neutral placeholder', () => {
    renderSection(withGroups([room({ members: [gm('reese'), gm('gone')] })]))
    expect(screen.getByRole('img', { name: 'Deleted bot' })).toBeInTheDocument()
  })

  it('makes avatars status-neutral while stale', () => {
    renderSection(withGroups([room()]), true)
    for (const s of screen.getAllByTestId('stub')) expect(s).not.toHaveAttribute('data-state', 'working')
  })

  it('shows an empty line and the New group button', () => {
    const { onNewGroup } = renderSection(withGroups([]))
    expect(screen.getByText('No groups yet')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New group' }))
    expect(onNewGroup).toHaveBeenCalled()
  })

  it('hides New group when groups are unavailable', () => {
    renderSection(withGroups([], { available: false }))
    expect(screen.queryByRole('button', { name: 'New group' })).toBeNull()
    expect(screen.getByText("Group chats need Hermes's group engine")).toBeInTheDocument()
  })
})

describe('Sidebar', () => {
  it('mounts Groups after Bots and before Hidden, and skips it on an older server', () => {
    const state = withGroups([room()])
    const { unmount } = render(<Sidebar state={{ ...state, bots: [...bots, bot({ name: 'h', title: 'Hid', hidden: true })] }} selected={null} onSelect={vi.fn()} />)
    const groups = screen.getAllByRole('group').map(g => g.getAttribute('aria-label'))
    expect(groups).toEqual(['Primary', 'Bots', 'Groups'])
    expect(screen.getByText('Hidden (1)').compareDocumentPosition(screen.getByRole('group', { name: 'Groups' })) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    unmount()
    render(<Sidebar state={crewState({ bots })} selected={null} onSelect={vi.fn()} />)
    expect(screen.queryByRole('group', { name: 'Groups' })).toBeNull()
  })
})
