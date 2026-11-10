import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SandboxSection } from '@/features/bots/SandboxSection'
import type { ImageStatus, SandboxView } from '@/features/bots/sandbox-types'

const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

const IMAGE = 'nousresearch/hermes-sandbox:desktop'
const view = (over: Partial<SandboxView> = {}): SandboxView => ({
  state: 'off', reasons: [], image: IMAGE, docker: 'ok', imagePresent: true, container: null, addedBrowserDisable: false, groups: [], ...over
})
const img = (over: Partial<ImageStatus> = {}): ImageStatus => ({ pulling: false, progress: null, error: null, image: IMAGE, docker: 'ok', present: true, ...over })
const reply = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

interface Handlers { get?: () => Promise<Response>; put?: (b: unknown) => Promise<Response>; image?: () => Promise<Response>; pull?: () => Promise<Response>; reset?: () => Promise<Response> }
function stub(h: Handlers = {}) {
  const fn = vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (url === '/crew/bots/dev/sandbox' && method === 'GET') return (h.get ?? (() => reply(view())))()
    if (url === '/crew/bots/dev/sandbox' && method === 'PUT') return (h.put ?? (() => reply(view({ state: 'on' }))))(JSON.parse(String(init?.body)))
    if (url === '/crew/bots/dev/sandbox/reset') return (h.reset ?? (() => reply(view())))()
    if (url === '/crew/sandbox/image' && method === 'GET') return (h.image ?? (() => reply(img())))()
    if (url === '/crew/sandbox/image/pull') return (h.pull ?? (() => reply(img({ pulling: true }), 202)))()
    return reply({})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const calls = (fn: ReturnType<typeof stub>, method: string, url: string) =>
  fn.mock.calls.filter(([u, i]) => u === url && ((i as RequestInit | undefined)?.method ?? 'GET') === method)
const open = () => render(<SandboxSection bot="dev" title="Scout" />)
const sw = () => screen.findByRole('switch', { name: "Run Scout's tools in a sandbox" })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  toast.success.mockClear()
})

describe('SandboxSection', () => {
  it('shows Sandbox ready, the switch and the notes', async () => {
    stub()
    open()
    expect(await screen.findByText('Sandbox ready')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Sandbox' })).toBeTruthy()
    expect(await sw()).toBeTruthy()
    for (const text of [
      "Commands, files, code and the bot's screen run inside an isolated container. It can't see your files, your keys or Crew.",
      "Browser tools are turned off in the sandbox. Hermes would run them outside the container, and on this computer the sandbox has no browser.",
      "Hermes doesn't ask before risky commands in the sandbox, because they can't touch your computer.",
      "Commands run as you, not as root, so the bot can't install system packages with apt. pip and npm installs into its own folders still work.",
      "Files in the bot's working folder are kept; anything else resets.",
      'An open chat switches when you reopen it.'
    ]) expect(screen.getByText(text)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Reset sandbox' })).toBeNull()
  })

  it('shows Running with the memory', async () => {
    stub({ get: () => reply(view({ state: 'on', container: { running: true, memMb: 312 } })) })
    open()
    expect(await screen.findByText('Running · 312 MB')).toBeTruthy()
    expect((await sw()).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'Reset sandbox' })).toBeTruthy()
  })

  it('shows Running without a number', async () => {
    stub({ get: () => reply(view({ state: 'on', container: { running: true, memMb: null } })) })
    open()
    expect(await screen.findByText('Running')).toBeTruthy()
  })

  it("shows Docker isn't available and keeps turning on disabled", async () => {
    stub({ get: () => reply(view({ docker: 'down', imagePresent: false })) })
    open()
    expect(await screen.findByText("Docker isn't available on this computer")).toBeTruthy()
    expect((await sw()).hasAttribute('data-disabled')).toBe(true)
  })

  it('offers the download when the image is missing and reloads when it is ready', async () => {
    let present = false
    const fn = stub({
      get: () => reply(view({ imagePresent: present })),
      image: () => reply(img({ present })),
      pull: () => { present = true; return reply(img({ present: true }), 200) }
    })
    open()
    expect(await screen.findByText("The sandbox image isn't downloaded")).toBeTruthy()
    expect((await sw()).hasAttribute('data-disabled')).toBe(true)
    fireEvent.click(await screen.findByRole('button', { name: 'Download (about 1.2 GB)' }))
    expect(await screen.findByText('Sandbox ready')).toBeTruthy()
    expect(calls(fn, 'GET', '/crew/bots/dev/sandbox').length).toBe(2)
  })

  it('starts one download for two quick clicks', async () => {
    let release: (r: Response) => void = () => undefined
    const fn = stub({ image: () => reply(img({ present: false })), get: () => reply(view({ imagePresent: false })), pull: () => new Promise<Response>(r => { release = r }) })
    open()
    const button = await screen.findByRole('button', { name: 'Download (about 1.2 GB)' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(calls(fn, 'POST', '/crew/sandbox/image/pull').length).toBe(1)
    await act(async () => release(new Response(JSON.stringify(img({ pulling: true })), { status: 202 })))
  })

  it('shows download progress and an error with Download again', async () => {
    const progress = { layersDone: 1, layersTotal: 4, bytesDone: null, bytesTotal: null }
    let status = img({ present: false, pulling: true, progress })
    stub({ get: () => reply(view({ imagePresent: false })), image: () => reply(status) })
    open()
    expect(await screen.findByText('Downloading… 1 of 4 parts')).toBeTruthy()
    expect(screen.getByLabelText('Download progress')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Download (about 1.2 GB)' }) as HTMLButtonElement).disabled).toBe(true)
    status = img({ present: false, pulling: false, error: 'no_space' })
    expect(await screen.findByText("There isn't enough disk space for the sandbox image.", {}, { timeout: 3000 })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Download again' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it("shows why a download couldn't start", async () => {
    stub({
      get: () => reply(view({ imagePresent: false })),
      image: () => reply(img({ present: false })),
      pull: () => reply({ error: 'docker_unavailable' }, 409)
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Download (about 1.2 GB)' }))
    expect(await screen.findByText("Docker isn't available on this computer", { selector: '[data-testid="image-failure"]' })).toBeTruthy()
  })

  it('still offers Download for a default-image bot when the image status fails', async () => {
    stub({ get: () => reply(view({ imagePresent: false })), image: () => reply({}, 500) })
    open()
    expect(await screen.findByRole('button', { name: 'Download (about 1.2 GB)' })).toBeTruthy()
    expect(screen.queryByText(/This bot uses its own image/)).toBeNull()
  })

  it('shows the pinned-image note instead of Download', async () => {
    stub({ get: () => reply(view({ imagePresent: false, image: 'my/own:1' })) })
    open()
    expect(await screen.findByText('This bot uses its own image, my/own:1. Download it with Docker.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Download/ })).toBeNull()
  })

  it('turns the sandbox on and off', async () => {
    let state: SandboxView['state'] = 'off'
    const fn = stub({ get: () => reply(view({ state })), put: b => { state = (b as { on: boolean }).on ? 'on' : 'off'; return reply(view({ state })) } })
    open()
    fireEvent.click(await sw())
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sandbox on'))
    const put = calls(fn, 'PUT', '/crew/bots/dev/sandbox')[0]?.[1] as RequestInit
    expect(JSON.parse(String(put.body))).toEqual({ on: true })
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'))
    fireEvent.click(screen.getByRole('switch'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sandbox off'))
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'))
  })

  it('re-reads the sandbox after a failed switch', async () => {
    let reads = 0
    const fn = stub({
      get: () => reply(view({ state: reads++ === 0 ? 'off' : 'on' })),
      put: () => reply({ error: 'not_saved' }, 502)
    })
    open()
    fireEvent.click(await sw())
    expect(await screen.findByText("Couldn't change the sandbox. Try again.")).toBeTruthy()
    await waitFor(() => expect(calls(fn, 'GET', '/crew/bots/dev/sandbox').length).toBe(2))
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true'))
  })

  it('lists the partial reasons', async () => {
    stub({ get: () => reply(view({ state: 'partial', reasons: ['Browser tools are on, so they run outside the sandbox', 'The sandbox is shared with other bots'] })) })
    open()
    expect(await screen.findByText(/Some settings reach outside the sandbox:/)).toBeTruthy()
    expect(screen.getByText('The sandbox is shared with other bots')).toBeTruthy()
    expect((await sw()).getAttribute('aria-checked')).toBe('true')
  })

  it('warns about group chats and names them', async () => {
    stub({ get: () => reply(view({ groups: [{ id: 'g1', name: 'Planning' }] })) })
    open()
    expect(await screen.findByText(/In these group chats Scout keeps its old setup, because Hermes fixes it when a group starts\. New groups use the sandbox\./)).toBeTruthy()
    expect(screen.getByText('Planning')).toBeTruthy()
  })

  it('opens What stays outside', async () => {
    stub()
    open()
    const toggle = await screen.findByRole('button', { name: 'What stays outside' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('MCP servers and routine scripts run on your computer.')).toBeNull()
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('MCP servers and routine scripts run on your computer.')).toBeTruthy()
    expect(screen.getByText('In these group chats Scout keeps its old setup, because Hermes fixes it when a group starts. New groups use the sandbox.')).toBeTruthy()
  })

  it('resets after a confirmation that says what is kept', async () => {
    const fn = stub({ get: () => reply(view({ state: 'on', container: { running: false, memMb: null } })) })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Reset sandbox' }))
    expect(await screen.findByText('Reset the sandbox?')).toBeTruthy()
    expect(screen.getByText("This removes Scout's container, so the next command starts fresh. Installed packages and running processes are lost. Files in the bot's working folder are kept; anything else resets.")).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: 'Reset sandbox' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Sandbox reset'))
    expect(calls(fn, 'POST', '/crew/bots/dev/sandbox/reset').length).toBe(1)
  })

  it("shows Couldn't check the sandbox with the reason", async () => {
    stub({ get: () => reply({ error: 'hermes_offline' }, 503) })
    open()
    expect(await screen.findByText("Couldn't check the sandbox: Hermes is offline")).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain("Couldn't check")
  })
})
