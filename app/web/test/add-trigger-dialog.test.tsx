import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import type { RoutineView } from '@/features/routines/types'
import { AddTriggerDialog } from '@/features/triggers/AddTriggerDialog'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const routine = { id: 'r1', bot: 'dev', title: 'Daily digest' } as RoutineView
const URL_ = 'http://127.0.0.1:7070/hooks/abc'
const SECRET = 's3cret'
const created = (over: Record<string, unknown> = {}) => ({ trigger: { id: 'abc' }, secret: SECRET, url: URL_, ...over })
const POST = 'POST /crew/bots/dev/triggers'

function stub(handler: () => Promise<Response>) {
  const fn = vi.fn((url: string, init: RequestInit = {}) => (`${init.method ?? 'GET'} ${url}` === POST ? handler() : json({})))
  vi.stubGlobal('fetch', fn)
  return fn
}
const posted = (fn: ReturnType<typeof stub>) => JSON.parse(String((fn.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === 'POST')![1] as RequestInit).body))
const onCreated = vi.fn()
const renderDialog = () => render(<AddTriggerDialog open onOpenChange={() => {}} bot="dev" routine={routine} onCreated={onCreated} />)
const name = (v: string) => fireEvent.change(screen.getByLabelText('Name'), { target: { value: v } })
const create = () => fireEvent.click(screen.getByRole('button', { name: 'Create' }))
const writeText = vi.fn(() => Promise.resolve())

beforeEach(() => { Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }) })
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('AddTriggerDialog', () => {
  it('creates a GitHub trigger from checkboxes, other types and actions', async () => {
    const fn = stub(() => json(created(), 201))
    renderDialog()
    name('Issues')
    fireEvent.click(screen.getByRole('checkbox', { name: 'issues' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'push' }))
    fireEvent.change(screen.getByLabelText('Other event types'), { target: { value: 'deployment, ,issues' } })
    fireEvent.change(screen.getByLabelText('Actions'), { target: { value: 'opened, closed' } })
    create()
    await screen.findByText('Trigger ready')
    expect(posted(fn)).toEqual({ routineId: 'r1', name: 'Issues', source: 'github', events: ['issues', 'push', 'deployment'], actions: ['opened', 'closed'] })
    expect(onCreated).toHaveBeenCalledTimes(1)
  })

  it('shows the URL, the secret once, copy buttons and the GitHub steps', async () => {
    stub(() => json(created(), 201))
    renderDialog()
    name('Issues')
    fireEvent.click(screen.getByRole('checkbox', { name: 'issues' }))
    create()
    expect(await screen.findByRole('dialog', { name: 'Trigger ready' })).toBeInTheDocument()
    expect(screen.getByText(URL_)).toBeInTheDocument()
    expect(screen.getByText(SECRET)).toBeInTheDocument()
    expect(screen.getByText('The secret is shown once.')).toBeInTheDocument()
    expect(screen.getByText('Reachable from this computer and your Mac tunnel; public access comes later.')).toBeInTheDocument()
    expect(screen.getByText('Content type: application/json.')).toBeInTheDocument()
    expect(screen.getByText('Events: issues.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(SECRET))
    fireEvent.click(screen.getByRole('button', { name: 'Copy URL' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(URL_))
    expect(toast.success).toHaveBeenCalledWith('Copied')
  })

  it("tells the user to copy by hand when the clipboard fails", async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    stub(() => json(created(), 201))
    renderDialog()
    name('Issues')
    create()
    await screen.findByText('Trigger ready')
    fireEvent.click(screen.getByRole('button', { name: 'Copy secret' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Couldn't copy. Select the text and copy it."))
  })

  it('shows a curl example for a Generic trigger with the url, secret and timestamp header', async () => {
    const fn = stub(() => json(created(), 201))
    renderDialog()
    name('Deploys')
    fireEvent.click(screen.getByRole('radio', { name: 'Generic' }))
    fireEvent.change(screen.getByLabelText('Event types'), { target: { value: 'deploy' } })
    create()
    await screen.findByText('Trigger ready')
    expect(posted(fn)).toEqual({ routineId: 'r1', name: 'Deploys', source: 'generic', events: ['deploy'], actions: [] })
    const curl = screen.getByTestId('curl-example')
    expect(curl).toHaveTextContent(`URL='${URL_}'`)
    expect(curl).toHaveTextContent(`SECRET='${SECRET}'`)
    expect(curl).toHaveTextContent('X-Crew-Timestamp: $TS')
    expect(curl).toHaveTextContent("X-Crew-Event: deploy")
    expect(screen.getByText(/Sign <timestamp>\.<body> with HMAC-SHA256/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Copy example' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(curl.textContent))
  })

  it('shows the tools warning and keeps Create off until a name is typed', () => {
    renderDialog()
    expect(screen.getByText("Runs started by events use this routine's tools. Outside text could try to steer the bot; it is marked as data, and risky actions are refused because nobody is there to approve them.")).toBeInTheDocument()
    expect(screen.getByText('Leave empty to accept every event.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    name('   ')
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    name('Hooks')
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
  })

  it('labels the source radios with a visible Source legend', () => {
    renderDialog()
    expect(screen.getByText('Source', { selector: 'legend' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Source' })).toContainElement(screen.getByRole('radio', { name: 'GitHub' }))
  })

  it('allows one submission at a time', async () => {
    let release: (r: Response) => void = () => {}
    const fn = stub(() => new Promise<Response>(r => { release = r }))
    renderDialog()
    name('Hooks')
    create()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    release(new Response(JSON.stringify(created()), { status: 201 }))
    await screen.findByText('Trigger ready')
    expect(fn.mock.calls.filter(([, i]) => (i as RequestInit | undefined)?.method === 'POST')).toHaveLength(1)
  })

  it('shows the server reason when creating fails', async () => {
    stub(() => json({ error: 'routine_not_found' }, 404))
    renderDialog()
    name('Hooks')
    create()
    expect(await screen.findByText('That routine no longer exists.')).toBeInTheDocument()
    expect(screen.queryByText('Trigger ready')).toBeNull()
  })

  it('warns when the new trigger is live but not on disk, and still shows the secret', async () => {
    stub(() => json(created({ saved: false }), 201))
    renderDialog()
    name('Hooks')
    create()
    expect(await screen.findByText(SECRET)).toBeInTheDocument()
    expect(toast.warning).toHaveBeenCalledWith("Saved for now, but Crew couldn't write it to disk yet.")
  })

  it('forgets the secret when the dialog closes', async () => {
    stub(() => json(created(), 201))
    const view = render(<AddTriggerDialog open onOpenChange={() => {}} bot="dev" routine={routine} onCreated={onCreated} />)
    name('Hooks')
    create()
    await screen.findByText(SECRET)
    view.rerender(<AddTriggerDialog open={false} onOpenChange={() => {}} bot="dev" routine={routine} onCreated={onCreated} />)
    view.rerender(<AddTriggerDialog open onOpenChange={() => {}} bot="dev" routine={routine} onCreated={onCreated} />)
    expect(screen.queryByText(SECRET)).toBeNull()
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })
})
