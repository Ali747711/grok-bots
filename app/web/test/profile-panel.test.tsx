import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ProfilePanel } from '@/features/bots/ProfilePanel'
import type { BotDetail } from '@/features/bots/types'

import { bot } from './fixtures'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const MODELS = { providers: [{ slug: 'openrouter', name: 'OpenRouter', is_current: true, models: ['a/one', 'b/two'] }], model: 'a/one', provider: 'openrouter' }
const detail = (over: Partial<BotDetail> = {}): BotDetail => ({
  name: 'dev', isPrimary: false, title: 'Dev', look: { shape: 'squircle', color: '#6366f1', imageKind: 'shape' }, hidden: false,
  description: 'Does dev', soul: 'Be nice', model: { provider: 'openrouter', model: 'a/one' }, metaRevision: 3, ...over
})

interface Routes { get?: () => Promise<Response>; patch?: (body: unknown) => Promise<Response>; del?: () => Promise<Response>; other?: Record<string, () => Promise<Response>> }

function stub(r: Routes = {}) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/api/model/options') return json(MODELS)
    const other = r.other?.[`${method} ${url}`]
    if (other) return other()
    if (url === '/crew/bots/dev' || url === '/crew/bots/hermes' || url === '/crew/bots/default') {
      if (method === 'PATCH') return (r.patch ?? (() => json({ status: 'saved', detail: detail() })))(JSON.parse(String(init?.body)))
      if (method === 'DELETE') return (r.del ?? (() => Promise.resolve(new Response(null, { status: 204 }))))()
      return (r.get ?? (() => json(detail())))()
    }
    return json({})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const patches = (fn: ReturnType<typeof stub>) =>
  fn.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => JSON.parse(String(init?.body)))
const gets = (fn: ReturnType<typeof stub>) => fn.mock.calls.filter(([u, i]) => u === '/crew/bots/dev' && (i?.method ?? 'GET') === 'GET').length

function Where() { return <div data-testid="where">{useLocation().pathname}</div> }
const open = (b = bot({ name: 'dev', title: 'Dev' })) =>
  render(
    <MemoryRouter initialEntries={['/bots/dev']}>
      <Routes>
        <Route path="*" element={<><ProfilePanel bot={b} /><Where /></>} />
      </Routes>
    </MemoryRouter>
  )
const loaded = () => screen.findByDisplayValue('Does dev')
const change = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
const save = () => fireEvent.click(screen.getByRole('button', { name: 'Save' }))

afterEach(() => vi.unstubAllGlobals())

describe('ProfilePanel', () => {
  it('shows the name, the read-only handle and the loaded fields', async () => {
    stub()
    open()
    await loaded()
    expect(screen.getByLabelText('Name')).toHaveValue('Dev')
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '80')
    expect(screen.getByText('@dev')).toBeInTheDocument()
    expect(screen.getByLabelText(/Persona/)).toHaveValue('Be nice')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('sends only the fields that changed, with baselines', async () => {
    const fn = stub()
    open()
    await loaded()
    change('Persona (SOUL.md)', 'Be brief')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ soul: 'Be brief', baseline: { soul: 'Be nice' } })
  })

  it('sends the name as the title and the baseline for the model', async () => {
    const fn = stub()
    open()
    await loaded()
    change('Name', 'Dev Two')
    await screen.findByRole('option', { name: 'b/two' })
    change('Model', 'b/two')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({
      title: 'Dev Two', model: { provider: 'openrouter', model: 'b/two' }, baseline: { model: { provider: 'openrouter', model: 'a/one' } }
    })
  })

  it('offers reload or save anyway on a conflict', async () => {
    const current = detail({ soul: 'Their soul' })
    let n = 0
    const fn = stub({ patch: () => (n++ === 0 ? json({ status: 'conflict', fields: ['soul'], current }, 409) : json({ status: 'saved', detail: detail({ soul: 'Mine' }) })) })
    open()
    await loaded()
    change('Persona (SOUL.md)', 'Mine')
    save()
    expect(await screen.findByText(/Changed in another app: soul/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }))
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ soul: 'Mine', baseline: { soul: 'Their soul' } })
    await waitFor(() => expect(screen.queryByText(/Changed in another app/)).toBeNull())
  })

  it('reloads their version from a conflict', async () => {
    stub({ patch: () => json({ status: 'conflict', fields: ['soul'], current: detail({ soul: 'Their soul' }) }, 409) })
    open()
    await loaded()
    change('Persona (SOUL.md)', 'Mine')
    save()
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Their soul'))
  })

  it('asks before an expensive model', async () => {
    let n = 0
    const fn = stub({ patch: () => (n++ === 0 ? json({ status: 'confirm_required', message: 'This model is expensive' }, 409) : json({ status: 'saved', detail: detail() })) })
    open()
    await loaded()
    await screen.findByRole('option', { name: 'b/two' })
    change('Model', 'b/two')
    save()
    expect(await screen.findByText('This model is expensive')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toMatchObject({ confirmExpensiveModel: true, model: { provider: 'openrouter', model: 'b/two' } })
  })

  it('shows the error after a failed save, re-reads the bot and keeps the edits', async () => {
    const fn = stub({ patch: () => json({ error: 'not_saved', section: 'soul' }, 502) })
    open()
    await loaded()
    change('Persona (SOUL.md)', 'Mine')
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save/)
    await waitFor(() => expect(gets(fn)).toBe(2))
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Mine')
  })

  it('hides the bot at once', async () => {
    const fn = stub({ patch: () => json({ status: 'saved', detail: detail({ hidden: true }) }) })
    open()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(patches(fn)).toEqual([{ hidden: true }]))
    expect(await screen.findByRole('button', { name: 'Show' })).toBeInTheDocument()
  })

  it('delete requires the typed handle and goes home', async () => {
    const fn = stub()
    open()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Delete bot' }))
    expect(screen.getByText(/permanently removes @dev's chats, routines, memory and files/)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type dev to confirm'), { target: { value: 'dev' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/))
    expect(fn.mock.calls.some(([u, i]) => u === '/crew/bots/dev' && i?.method === 'DELETE')).toBe(true)
  })

  it('has no delete for the primary bot', async () => {
    stub({ get: () => json(detail({ name: 'default', isPrimary: true, title: 'Hermes' })) })
    open(bot({ name: 'default', title: 'Hermes', isPrimary: true }))
    await loaded()
    expect(screen.queryByRole('button', { name: 'Delete bot' })).toBeNull()
    expect(screen.getByText('@hermes')).toBeInTheDocument()
  })

  it('offers Finish setup only for an unfinished bot', async () => {
    const fn = stub({ other: { 'POST /crew/bots/dev/finish': () => json({ name: 'dev', complete: true, steps: {}, needsModel: false }) } })
    const { unmount } = open()
    await loaded()
    expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull()
    unmount()
    open(bot({ name: 'dev', title: 'Dev', setupIncomplete: true }))
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    await waitFor(() => expect(fn.mock.calls.some(([u]) => u === '/crew/bots/dev/finish')).toBe(true))
    const call = fn.mock.calls.find(([u]) => u === '/crew/bots/dev/finish')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ title: 'Dev', look: { shape: 'squircle', color: '#6366f1' } })
  })

  it('removes a photo at once', async () => {
    const fn = stub({ get: () => json(detail({ look: { shape: 'squircle', color: '#6366f1', imageKind: 'photo' } })), other: { 'DELETE /crew/bots/dev/avatar': () => json(detail()) } })
    open()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => u === '/crew/bots/dev/avatar' && i?.method === 'DELETE')).toBe(true))
  })
})
