import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deriveAvatarType } from '@/features/avatars/avatar-model'
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
    expect(await screen.findByText(/Changed in another app: Persona/)).toBeInTheDocument()
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
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ title: 'Dev', avatar: { type: deriveAvatarType('dev'), color: '#6366f1' } })
  })

  it('removes a photo at once', async () => {
    const fn = stub({ get: () => json(detail({ look: { shape: 'squircle', color: '#6366f1', imageKind: 'photo' } })), other: { 'DELETE /crew/bots/dev/avatar': () => json(detail()) } })
    open()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => u === '/crew/bots/dev/avatar' && i?.method === 'DELETE')).toBe(true))
  })

  it('does not revert another app\'s edit after a photo refresh', async () => {
    const fn = stub({
      get: () => json(detail({ look: { shape: 'squircle', color: '#6366f1', imageKind: 'photo' } })),
      other: { 'DELETE /crew/bots/dev/avatar': () => json(detail({ soul: 'Their soul' })) }
    })
    open()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    await waitFor(() => expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Their soul'))
    change('Name', 'Dev Two')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ title: 'Dev Two' })
  })

  it('after a failed save keeps only what Hermes did not write as unsaved', async () => {
    let reads = 0
    let n = 0
    const fn = stub({
      get: () => json(reads++ === 0 ? detail() : detail({ description: 'New job' })),
      patch: () => (n++ === 0 ? json({ error: 'not_saved' }, 502) : json({ status: 'saved', detail: detail({ description: 'New job', soul: 'Mine' }) }))
    })
    open()
    await loaded()
    change('Job', 'New job')
    change('Persona (SOUL.md)', 'Mine')
    save()
    await screen.findByRole('alert')
    await waitFor(() => expect(reads).toBe(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ soul: 'Mine', baseline: { soul: 'Be nice' } })
  })

  it('keeps the original baseline for a field edited here and changed elsewhere', async () => {
    const fn = stub({ patch: body => ((body as { hidden?: boolean }).hidden ? json({ status: 'saved', detail: detail({ hidden: true, soul: 'Their soul' }) }) : json({ status: 'saved', detail: detail() })) })
    open()
    await loaded()
    change('Persona (SOUL.md)', 'Mine')
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    await screen.findByRole('button', { name: 'Show' })
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Mine')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ soul: 'Mine', baseline: { soul: 'Be nice' } })
  })

  it('shows an error when hiding fails', async () => {
    stub({ patch: () => json({ error: 'hermes_error' }, 502) })
    open()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Hide' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save/)
    expect(screen.getByRole('button', { name: 'Hide' })).toBeEnabled()
  })

  it('shows an error when finishing setup fails', async () => {
    stub({ other: { 'POST /crew/bots/dev/finish': () => json({ error: 'hermes_error' }, 502) } })
    open(bot({ name: 'dev', title: 'Dev', setupIncomplete: true }))
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not/)
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeEnabled()
  })

  it('W1: sends only the colour when only the colour changed, and keeps an unknown shape', async () => {
    const blob = detail({ look: { shape: 'blobatar', color: '#6366f1', imageKind: 'shape' } })
    const fn = stub({ get: () => json(blob), patch: () => json({ status: 'saved', detail: blob }) })
    open()
    await loaded()
    expect(screen.getByRole('button', { name: 'Current shape' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Violet' }))
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ look: { color: '#7c3aed' } })
  })

  it('W1: sends only the shape when only the shape changed', async () => {
    const fn = stub()
    open()
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Circle' }))
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ look: { shape: 'circle' } })
  })

  it('W3: says so when Finish setup does not complete', async () => {
    stub({ other: { 'POST /crew/bots/dev/finish': () => json({ name: 'dev', complete: false, steps: {}, needsModel: false, error: { step: 'look', message: 'ui_meta refused' } }) } })
    open(bot({ name: 'dev', title: 'Dev', setupIncomplete: true }))
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Finish setup didn't complete: ui_meta refused")
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeInTheDocument()
  })

  it('W4: the conflict banner uses the field labels', async () => {
    stub({ patch: () => json({ status: 'conflict', fields: ['description', 'soul', 'model'], current: detail() }, 409) })
    open()
    await loaded()
    change('Job', 'Mine')
    save()
    expect(await screen.findByText(/Changed in another app: Job, Persona, Model\./)).toBeInTheDocument()
  })

  it('W5: Job and Persona have length limits', async () => {
    stub()
    open()
    await loaded()
    expect(screen.getByLabelText('Job')).toHaveAttribute('maxlength', '2000')
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveAttribute('maxlength', '100000')
  })

  it('W5: a Crew validation error is never labelled as Hermes refusing', async () => {
    stub({ patch: () => json({ error: 'bad_body', message: 'Too big: expected string <=2000' }, 400) })
    open()
    await loaded()
    change('Job', 'x')
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent("Some fields aren't filled in correctly.")
    expect(screen.queryByText(/Hermes refused/)).toBeNull()
  })

  it("W5: Hermes's own refusal keeps its words", async () => {
    stub({ patch: () => json({ error: 'rejected', message: 'No such model' }, 400) })
    open()
    await loaded()
    change('Job', 'x')
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('Hermes refused it: No such model')
  })
})
