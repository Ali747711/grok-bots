import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewGroupDialog } from '@/features/groups/NewGroupDialog'

import { bot } from './fixtures'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: () => <div data-testid="stub" /> }
})
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const names = ['crew-test', 'e2e1', 'a', 'b', 'c', 'd', 'e']
const bots = names.map(n => bot({ name: n, title: n === 'e2e1' ? 'E2E One' : n }))
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const setup = (create: () => Promise<Response>) => {
  const fn = vi.fn((_url: string, _init?: RequestInit) => create())
  vi.stubGlobal('fetch', fn)
  const onCreated = vi.fn()
  const onOpenChange = vi.fn()
  render(<NewGroupDialog open onOpenChange={onOpenChange} bots={bots} onCreated={onCreated} />)
  return { fn, onCreated, onOpenChange }
}
const pick = (title: string) => fireEvent.click(screen.getByRole('checkbox', { name: title }))
const create = () => screen.getByRole('button', { name: 'Create group' })
afterEach(() => { vi.unstubAllGlobals(); toast.success.mockReset() })

describe('NewGroupDialog', () => {
  it('creates a group from 2 picked bots and opens it', async () => {
    const { fn, onCreated, onOpenChange } = setup(() => json({ roomId: 'r1', routing: 'auto' }, 201))
    pick('crew-test')
    pick('E2E One')
    expect(screen.getByPlaceholderText('crew-test, E2E One')).toBeInTheDocument()
    fireEvent.click(create())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('r1', undefined))
    expect(JSON.parse(fn.mock.calls[0]![1]!.body as string)).toEqual({ members: ['crew-test', 'e2e1'] })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('uses the spec copy', () => {
    setup(() => json({}))
    expect(screen.getByText('Members are set when the group is created.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create group' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Group name' })).toHaveAttribute('placeholder', '')
    expect(screen.queryByText('Pick 2 to 6 bots that will talk together.')).toBeNull()
  })

  it('shows each bot with its handle and counts the picks', () => {
    setup(() => json({}))
    const row = screen.getByRole('checkbox', { name: 'E2E One' }).closest('label')!
    expect(row).toHaveTextContent('E2E One')
    expect(row).toHaveTextContent('@e2e1')
    expect(screen.getByRole('status')).toHaveTextContent('0 of 6 picked')
    pick('a'); pick('E2E One')
    expect(screen.getByRole('status')).toHaveTextContent('2 of 6 picked')
  })

  it('shows the primary bot under the handle groups give it', () => {
    vi.stubGlobal('fetch', vi.fn())
    render(<NewGroupDialog open onOpenChange={vi.fn()} bots={[bot({ name: 'default', title: 'Hermes', isPrimary: true }), bot({ name: 'a', title: 'A' })]} onCreated={vi.fn()} />)
    const row = screen.getByRole('checkbox', { name: 'Hermes' }).closest('label')!
    expect(row).toHaveTextContent('@hermes')
    expect(row).not.toHaveTextContent('@default')
  })

  it('sends a typed name and toasts the routing warning', async () => {
    const { fn, onCreated } = setup(() => json({ roomId: 'r1', routing: 'everyone', warning: 'routing_not_set' }, 201))
    pick('a'); pick('b')
    fireEvent.change(screen.getByLabelText('Group name'), { target: { value: '  Crew  ' } })
    fireEvent.click(create())
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('r1', 'routing_not_set'))
    expect(JSON.parse(fn.mock.calls[0]![1]!.body as string)).toEqual({ name: 'Crew', members: ['a', 'b'] })
    expect(toast.success).toHaveBeenCalledWith("Group made, but Auto replies couldn't be switched on. Set it in the group panel.")
  })

  it('keeps Create disabled below 2 and blocks a 7th pick', () => {
    setup(() => json({}))
    expect(create()).toBeDisabled()
    pick('a')
    expect(create()).toBeDisabled()
    pick('b')
    expect(create()).toBeEnabled()
    for (const n of ['c', 'd', 'e', 'crew-test']) pick(n)
    const seventh = screen.getByRole('checkbox', { name: 'E2E One' })
    expect(seventh).toHaveAttribute('aria-disabled', 'true')
    expect(seventh).toHaveAttribute('title', 'Up to 6 bots')
    expect(screen.getByRole('checkbox', { name: 'a' })).not.toHaveAttribute('aria-disabled', 'true')
  })

  it('shows the server reason when a bot cannot join', async () => {
    const { onCreated } = setup(() => json({ error: 'bad_members', reason: 'not_seatable', profile: 'e2e1' }, 400))
    pick('crew-test'); pick('E2E One')
    fireEvent.click(create())
    expect(await screen.findByRole('alert')).toHaveTextContent("E2E One can't join a group")
    expect(onCreated).not.toHaveBeenCalled()
  })

  it('shows plain words for other failures and submits once at a time', async () => {
    let resolve: (r: Response) => void = () => undefined
    const { fn } = setup(() => new Promise<Response>(r => { resolve = r }))
    pick('a'); pick('b')
    fireEvent.click(create())
    expect(create()).toBeDisabled()
    fireEvent.click(create())
    expect(fn).toHaveBeenCalledTimes(1)
    resolve(new Response(JSON.stringify({ error: 'groups_unavailable' }), { status: 409 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Group chats are not available right now')
  })
})
