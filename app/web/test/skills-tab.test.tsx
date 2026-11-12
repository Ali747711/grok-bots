import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ToolsetView } from '@/features/profile/profile-api'
import { SkillsTab } from '@/features/profile/SkillsTab'
import { TOOLSET_COPY } from '@/features/profile/toolset-copy'
import { UNCONFIRMED } from '@/features/profile/use-profile-row-action'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const row = (name: string, over: Partial<ToolsetView> = {}): ToolsetView => ({ name, label: `Hermes ${name}`, description: `${name}_tool`, enabled: true, needsSetup: false, ...over })
const ROWS = (): ToolsetView[] => [row('web'), row('browser'), row('terminal'), row('computer_use'), row('cronjob')]
const PATH = '/crew/bots/dev/toolsets'

interface Server {
  rows: ToolsetView[]
  /** An answer for the next PUT instead of applying it. */
  refuse?: () => Promise<Response>
  /** An answer for every GET. */
  failRead?: () => Promise<Response>
}

/** The toolsets route as a small stateful server: a PUT changes what the next GET returns. */
function stub(server: Server) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    if (url !== PATH) return json({})
    if ((init?.method ?? 'GET') === 'GET') return server.failRead ? server.failRead() : json(server.rows)
    if (server.refuse) return server.refuse()
    const body = JSON.parse(String(init?.body)) as { name: string; enabled: boolean }
    server.rows = server.rows.map(r => (r.name === body.name ? { ...r, enabled: body.enabled } : r))
    return json(server.rows)
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
type Stub = ReturnType<typeof stub>
const puts = (fn: Stub) => fn.mock.calls.filter(([, i]) => i?.method === 'PUT').map(([, i]) => JSON.parse(String(i?.body)) as unknown)
const reads = (fn: Stub) => fn.mock.calls.filter(([u, i]) => u === PATH && (i?.method ?? 'GET') === 'GET').length

const open = (isPrimary = false) => render(<SkillsTab name="dev" title="Scout" isPrimary={isPrimary} />)
const toggle = (label: string) => screen.findByRole('switch', { name: label })
const item = (label: string) => screen.getByRole('switch', { name: label }).closest('li')!

afterEach(() => vi.unstubAllGlobals())

describe('toolset copy', () => {
  it('names the fifteen switches Crew offers', () => {
    expect(Object.keys(TOOLSET_COPY)).toEqual([
      'web', 'browser', 'terminal', 'file', 'code_execution', 'vision', 'image_gen', 'tts', 'skills', 'todo', 'memory', 'session_search', 'delegation', 'cronjob', 'computer_use'
    ])
    expect(TOOLSET_COPY.skills).toEqual({ label: 'Skill documents', description: 'Use and manage Hermes skill documents.' })
    expect(TOOLSET_COPY.cronjob).toEqual({ label: 'Scheduling', description: 'Create its own routines. Yours stay as they are.' })
  })
})

describe('SkillsTab', () => {
  it('lists toolsets with Crew copy and switches one off with PUT', async () => {
    const fn = stub({ rows: [...ROWS(), row('x_search', { label: 'X (Twitter) Search', description: 'x_search' })] })
    open()
    const web = await toggle('Web search')
    expect(screen.getByRole('heading', { name: 'Skills' })).toBeInTheDocument()
    expect(screen.getAllByRole('switch').map(s => s.getAttribute('aria-label'))).toEqual(['Web search', 'Browser', 'Terminal', 'Screen control', 'Scheduling', 'X (Twitter) Search'])
    expect(within(item('Web search')).getByText('Search the web and read pages.')).toBeInTheDocument()
    // A toolset Crew has no copy for keeps Hermes's own label and description.
    expect(within(item('X (Twitter) Search')).getByText('x_search')).toBeInTheDocument()
    expect(screen.queryByText('Hermes web')).toBeNull()
    expect(web).toHaveAttribute('aria-checked', 'true')

    fireEvent.click(web)
    await waitFor(() => expect(puts(fn)).toEqual([{ name: 'web', enabled: false }]))
    await waitFor(() => expect(web).toHaveAttribute('aria-checked', 'false'))
    await waitFor(() => expect(web).toBeEnabled())
    // Re-read after the write: the row shows what Hermes holds.
    expect(reads(fn)).toBe(2)
    fireEvent.click(web)
    await waitFor(() => expect(puts(fn)).toEqual([{ name: 'web', enabled: false }, { name: 'web', enabled: true }]))
    await waitFor(() => expect(web).toHaveAttribute('aria-checked', 'true'))
  })

  it('shows the sandbox lock on browser and the setup note', async () => {
    const rows = ROWS().map(r => (r.name === 'browser' ? { ...r, enabled: false, locked: 'sandbox' as const } : r.name === 'web' ? { ...r, needsSetup: true } : r))
    const fn = stub({ rows })
    open()
    const browser = await toggle('Browser')
    expect(browser).toBeDisabled()
    expect(within(item('Browser')).getByText('Off while Scout runs in a sandbox')).toBeInTheDocument()
    expect(within(item('Web search')).getByText('Needs setup in Hermes')).toBeInTheDocument()
    expect(within(item('Terminal')).queryByText('Needs setup in Hermes')).toBeNull()
    expect(screen.getAllByText('Off while Scout runs in a sandbox')).toHaveLength(1)
    fireEvent.click(browser)
    expect(puts(fn)).toEqual([])
    // A row that needs setup can still be switched.
    expect(screen.getByRole('switch', { name: 'Web search' })).toBeEnabled()
  })

  it('warns when terminal or computer_use is off', async () => {
    const fn = stub({ rows: ROWS() })
    open()
    const terminal = await toggle('Terminal')
    const TERMINAL = 'Most work needs this, including approvals and many routines.'
    const SCREEN = "Without it, Scout can't act on its screen."
    expect(screen.queryByText(TERMINAL)).toBeNull()
    expect(screen.queryByText(SCREEN)).toBeNull()
    fireEvent.click(terminal)
    expect(await within(item('Terminal')).findByText(TERMINAL)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch', { name: 'Screen control' }))
    expect(await within(item('Screen control')).findByText(SCREEN)).toBeInTheDocument()
    expect(puts(fn)).toEqual([{ name: 'terminal', enabled: false }, { name: 'computer_use', enabled: false }])
  })

  it('shows the next-message note and is read-only on the primary', async () => {
    const fn = stub({ rows: ROWS() })
    const view = open()
    await toggle('Web search')
    expect(screen.getByText("Applies from Scout's next message.")).toBeInTheDocument()
    expect(screen.queryByText(/New bots copy/)).toBeNull()
    view.unmount()

    open(true)
    await toggle('Web search')
    expect(screen.getByText("Applies from Scout's next message.")).toBeInTheDocument()
    expect(screen.getByText("New bots copy Scout's settings, so change these in Hermes")).toBeInTheDocument()
    // The primary's switches show what it has and send nothing.
    expect(screen.getByRole('switch', { name: 'Web search' })).toHaveAttribute('aria-checked', 'true')
    for (const s of screen.getAllByRole('switch')) {
      expect(s).toBeDisabled()
      fireEvent.click(s)
    }
    expect(puts(fn)).toEqual([])
  })

  it('shows an error on the row and re-reads after a refused change', async () => {
    const server: Server = { rows: ROWS(), refuse: () => json({ error: 'toolset_locked' }, 409) }
    const fn = stub(server)
    open()
    const browser = await toggle('Browser')
    // The sandbox came on in another tab: the next read says so.
    server.rows = server.rows.map(r => (r.name === 'browser' ? { ...r, enabled: false, locked: 'sandbox' as const } : r))
    fireEvent.click(browser)
    expect(await within(item('Browser')).findByRole('alert')).toHaveTextContent('Off while Scout runs in a sandbox')
    await waitFor(() => expect(reads(fn)).toBe(2))
    await waitFor(() => expect(browser).toHaveAttribute('aria-checked', 'false'))
    expect(browser).toBeDisabled()
    // The error belongs to that row only.
    expect(within(item('Web search')).queryByRole('alert')).toBeNull()
    // The lock is said once, not as an alert and a note.
    expect(within(item('Browser')).getAllByText('Off while Scout runs in a sandbox')).toHaveLength(1)
  })

  it("shows Hermes's own words for a failed write and keeps the switch as Hermes has it", async () => {
    const fn = stub({ rows: ROWS(), refuse: () => json({ error: 'hermes_error', message: 'config.yaml is read-only' }, 502) })
    open()
    const web = await toggle('Web search')
    fireEvent.click(web)
    expect(await within(item('Web search')).findByRole('alert')).toHaveTextContent('config.yaml is read-only')
    await waitFor(() => expect(web).toBeEnabled())
    expect(web).toHaveAttribute('aria-checked', 'true')
    expect(reads(fn)).toBe(2)
  })

  it('holds only the row being changed while its write runs', async () => {
    let release: (r: Response) => void = () => undefined
    const fn = stub({ rows: ROWS(), refuse: () => new Promise<Response>(r => { release = r }) })
    open()
    const web = await toggle('Web search')
    fireEvent.click(web)
    await waitFor(() => expect(web).toBeDisabled())
    expect(screen.getByRole('switch', { name: 'Terminal' })).toBeEnabled()
    fireEvent.click(web)
    expect(puts(fn)).toHaveLength(1)
    release(new Response(JSON.stringify(ROWS().map(r => (r.name === 'web' ? { ...r, enabled: false } : r)))))
    await waitFor(() => expect(web).toBeEnabled())
  })

  it('says why when the skills cannot be read, and shows no switch', async () => {
    stub({ rows: [], failRead: () => json({ error: 'hermes_offline' }, 503) })
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't read this setting: Hermes is offline")
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('treats an answer of the wrong shape as a failed read', async () => {
    stub({ rows: [], failRead: () => json({ nope: true }) })
    open()
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't read this setting: Hermes didn't answer")
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('keeps the written switch and says it could not be re-checked when the re-read fails', async () => {
    const server: Server = { rows: ROWS() }
    const fn = stub(server)
    open()
    const web = await toggle('Web search')
    server.failRead = () => json({ error: 'hermes_offline' }, 503)
    fireEvent.click(web)
    expect(await within(item('Web search')).findByRole('status')).toHaveTextContent(UNCONFIRMED)
    expect(puts(fn)).toEqual([{ name: 'web', enabled: false }])
    expect(web).toHaveAttribute('aria-checked', 'false')
    expect(web).toBeEnabled()
    // Only the row that wrote says so, and it is not an error of that row.
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(within(item('Web search')).queryByRole('alert')).toBeNull()
  })

  it('shows the switch as just sent when the write answers with another shape and the re-read fails', async () => {
    const server: Server = { rows: ROWS(), refuse: () => json({ ok: true }) }
    stub(server)
    open()
    const web = await toggle('Web search')
    server.failRead = () => json({ error: 'hermes_offline' }, 503)
    fireEvent.click(web)
    expect(await within(item('Web search')).findByRole('status')).toHaveTextContent(UNCONFIRMED)
    expect(web).toHaveAttribute('aria-checked', 'false')
  })

  it('shows the error and the old switch when the write fails, even if the re-read fails too', async () => {
    const server: Server = { rows: ROWS(), refuse: () => json({ error: 'hermes_error', message: 'config.yaml is read-only' }, 502) }
    stub(server)
    open()
    const web = await toggle('Web search')
    server.failRead = () => json({ error: 'hermes_offline' }, 503)
    fireEvent.click(web)
    expect(await within(item('Web search')).findByRole('alert')).toHaveTextContent('config.yaml is read-only')
    await waitFor(() => expect(web).toBeEnabled())
    expect(web).toHaveAttribute('aria-checked', 'true')
    expect(screen.queryByRole('status')).toBeNull()
  })
})
