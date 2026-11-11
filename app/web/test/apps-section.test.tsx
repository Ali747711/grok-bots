import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AppsList, BotAppsView } from '@/features/apps/apps-types'
import { AppsSection } from '@/features/bots/AppsSection'

const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const view = (over: Partial<BotAppsView> = {}): BotAppsView => ({
  apps: [], offered: ['read', 'change', 'all'], asks: true, keyConfigured: true, roomWritesDeclined: false, ...over
})
const github = { id: 'c1', toolkit: 'github', name: 'GitHub', status: 'connected' as const }
const list = (apps: AppsList['apps'] = [github]): AppsList => ({ apps, usage: {} })
const entry = (over: Partial<BotAppsView['apps'][number]> = {}) =>
  ({ toolkit: 'github', name: 'GitHub', level: 'read' as const, tools: 12, capped: false, ...over })

interface Handlers { list?: () => Promise<Response>; get?: () => Promise<Response>; put?: (b: unknown) => Promise<Response> }
function stub(h: Handlers = {}) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/crew/connectors/apps') return (h.list ?? (() => reply(list())))()
    if (url === '/crew/bots/dev/apps' && method === 'GET') return (h.get ?? (() => reply(view())))()
    if (url === '/crew/bots/dev/apps' && method === 'PUT') return (h.put ?? (() => reply(view())))(JSON.parse(String(init?.body)))
    return reply({})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const puts = (fn: ReturnType<typeof stub>) =>
  fn.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'PUT').map(([, i]) => JSON.parse(String((i as RequestInit).body)))
const open = (sandboxed = true) => render(<AppsSection bot="dev" title="Scout" sandboxed={sandboxed} />)
const sw = () => screen.findByRole('switch', { name: 'Let Scout use GitHub' })
/** The level chips of one app: a radio group named "<App> access". */
const access = (app = 'GitHub') => screen.findByRole('radiogroup', { name: `${app} access` })
const noAccess = (app = 'GitHub') => screen.queryByRole('radiogroup', { name: `${app} access` })
const levels = (group: HTMLElement) => within(group).getAllByRole('radio').map(r => r.parentElement?.textContent)
const level = (group: HTMLElement, name: string) => within(group).getByRole('radio', { name })

afterEach(() => {
  vi.unstubAllGlobals()
  toast.success.mockClear()
})

describe('AppsSection', () => {
  it('lists connected apps with a switch and turns one on at Read only', async () => {
    // The row is read again after the write, so the stub answers as Hermes would: with what was saved.
    let saved = view()
    const fn = stub({ get: () => reply(saved), put: () => reply(saved = view({ apps: [entry()] })) })
    open()
    expect(screen.getByRole('heading', { name: 'Apps' })).toBeTruthy()
    const s = await sw()
    expect(s.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByRole('radiogroup')).toBeNull()
    fireEvent.click(s)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Apps updated'))
    expect(puts(fn)).toEqual([{ github: 'read' }])
    expect((await sw()).getAttribute('aria-checked')).toBe('true')
    const group = await access()
    expect(level(group, 'Read only')).toBeChecked()
    // The levels are chips, not a menu.
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('changes the level and offers only the levels the server allows', async () => {
    let saved = view({ apps: [entry()] })
    const fn = stub({ get: () => reply(saved), put: () => reply(saved = view({ apps: [entry({ level: 'change' })] })) })
    open()
    await sw()
    const group = await access()
    expect(levels(group)).toEqual(['Read only', 'Read and change', 'Everything'])
    expect(level(group, 'Read only')).toBeChecked()
    // The level already chosen writes nothing.
    fireEvent.click(level(group, 'Read only'))
    fireEvent.click(level(group, 'Read and change'))
    await waitFor(() => expect(puts(fn)).toEqual([{ github: 'change' }]))
    await waitFor(() => expect(level(group, 'Read and change')).toBeChecked())
  })

  it('offers no Everything when the bot does not ask', async () => {
    stub({ get: () => reply(view({ apps: [entry()], offered: ['read'], asks: false })) })
    open()
    expect(levels(await access())).toEqual(['Read only'])
  })

  it('turns an app off with the whole map minus it', async () => {
    const slack = { id: 'c2', toolkit: 'slack', name: 'Slack', status: 'connected' as const }
    const fn = stub({
      list: () => reply(list([github, slack])),
      get: () => reply(view({ apps: [entry(), entry({ toolkit: 'slack', name: 'Slack' })] })),
      put: () => reply(view({ apps: [entry({ toolkit: 'slack', name: 'Slack' })] }))
    })
    open()
    fireEvent.click(await sw())
    await waitFor(() => expect(puts(fn)).toEqual([{ slack: 'read' }]))
  })

  it('shows Not connected for an app the bot has but nobody is signed in to', async () => {
    stub({ list: () => reply(list([])), get: () => reply(view({ apps: [entry()] })) })
    open()
    expect(await screen.findByText('Not connected')).toBeTruthy()
    expect(screen.getByText('GitHub')).toBeTruthy()
    expect((await sw()).getAttribute('aria-checked')).toBe('true')
    expect(noAccess()).toBeNull()
  })

  it('shows the three notes always, and the sandbox, approvals and group lines when they apply', async () => {
    stub({ get: () => reply(view({ asks: false, roomWritesDeclined: true })) })
    open(false)
    for (const text of [
      'Actions that change something ask you first in the chat.',
      'Routines can only use read-only app tools.',
      'Changes apply to new chats within a minute.',
      "This bot isn't sandboxed, so it can read files on this computer, including your Composio key. Turn on the sandbox for bots that use apps.",
      "This bot doesn't ask before actions, so it can only read in apps.",
      'In group chats, app actions that change something are declined.'
    ]) expect(await screen.findByText(text)).toBeTruthy()
  })

  it('hides the sandbox, approvals and group lines when they do not apply', async () => {
    stub()
    open(true)
    await sw()
    expect(screen.getByText('Routines can only use read-only app tools.')).toBeTruthy()
    expect(screen.queryByText(/isn't sandboxed/)).toBeNull()
    expect(screen.queryByText(/doesn't ask before actions/)).toBeNull()
    expect(screen.queryByText(/In group chats/)).toBeNull()
  })

  it('shows the cap note', async () => {
    stub({ get: () => reply(view({ apps: [entry({ capped: true, tools: 40 })] })) })
    open()
    expect(await screen.findByText('GitHub has more tools than a bot can hold, so only 40 are on.')).toBeTruthy()
  })

  it('re-reads after a failed change and shows the reason', async () => {
    const get = vi.fn(() => reply(view({ apps: [entry()] })))
    stub({ get, put: () => reply({ error: 'level_unavailable' }, 409) })
    open()
    const group = await access()
    fireEvent.click(level(group, 'Everything'))
    // The reason is said on the row that was changed.
    const row = group.closest('li')!
    expect(await within(row).findByRole('alert')).toHaveTextContent("This bot doesn't ask before actions, so it can only read in apps.")
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(level(group, 'Read only')).toBeEnabled())
    expect(level(group, 'Read only')).toBeChecked()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('says Hermes is offline on a 503', async () => {
    stub({ put: () => reply({ error: 'hermes_offline' }, 503) })
    open()
    fireEvent.click(await sw())
    expect(await screen.findByText('Hermes is offline')).toBeTruthy()
  })

  it('disables the controls while a change runs', async () => {
    let release: (r: Response) => void = () => undefined
    const slack = { id: 'c2', toolkit: 'slack', name: 'Slack', status: 'connected' as const }
    const fn = stub({
      list: () => reply(list([github, slack])),
      get: () => reply(view({ apps: [entry({ toolkit: 'slack', name: 'Slack' })] })),
      put: () => new Promise<Response>(r => { release = r })
    })
    open()
    const s = await sw()
    const group = await access('Slack')
    fireEvent.click(s)
    await waitFor(() => expect(s).toBeDisabled())
    // One write carries every app's level, so the other rows wait too.
    for (const radio of within(group).getAllByRole('radio')) expect(radio).toBeDisabled()
    fireEvent.click(level(group, 'Everything'))
    expect(puts(fn)).toHaveLength(1)
    release(new Response(JSON.stringify(view({ apps: [entry()] })), { status: 200 }))
    await waitFor(() => expect(toast.success).toHaveBeenCalled())
  })

  it('offers Open Apps when nothing is connected', async () => {
    stub({ list: () => reply(list([])) })
    const seen: unknown[] = []
    const on = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener('crew:open-dialog', on)
    open()
    expect(await screen.findByText('No apps connected yet.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Open Apps' }))
    window.removeEventListener('crew:open-dialog', on)
    expect(seen).toEqual(['apps'])
  })

  it('offers Set the key in Settings without a key', async () => {
    stub({ list: () => reply({ error: 'no_key' }, 409), get: () => reply(view({ keyConfigured: false })) })
    const seen: unknown[] = []
    const on = (e: Event) => seen.push((e as CustomEvent).detail)
    window.addEventListener('crew:open-dialog', on)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Set the key in Settings' }))
    window.removeEventListener('crew:open-dialog', on)
    expect(seen).toEqual(['settings'])
    expect(screen.queryByText('No apps connected yet.')).toBeNull()
  })

  it('shows no access chips until the apps list is known', async () => {
    let release: (r: Response) => void = () => undefined
    stub({ list: () => new Promise<Response>(r => { release = r }), get: () => reply(view({ apps: [entry()] })) })
    open()
    expect((await sw()).getAttribute('aria-checked')).toBe('true')
    expect(noAccess()).toBeNull()
    release(new Response(JSON.stringify(list())))
    expect(await access()).toBeTruthy()
  })

  it('re-reads after a key is saved elsewhere', async () => {
    let keyed = false
    stub({
      list: () => (keyed ? reply(list()) : reply({ error: 'no_key' }, 409)),
      get: () => reply(view({ keyConfigured: keyed }))
    })
    open()
    expect(await screen.findByRole('button', { name: 'Set the key in Settings' })).toBeTruthy()
    keyed = true
    act(() => { window.dispatchEvent(new CustomEvent('crew:key-changed')) })
    expect(await sw()).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Set the key in Settings' })).toBeNull()
  })
})
