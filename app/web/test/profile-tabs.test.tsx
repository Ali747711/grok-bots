import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deriveAvatarType } from '@/features/avatars/avatar-model'
import { clearProfileDrafts } from '@/features/profile/profile-drafts'

import { change, detail, dev, goTab, json, loaded, open, patches, save, saveButton, stub, tree, where } from './profile-harness'
import { puts } from './profile-settings-stub'

const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-type={String(props.type)} /> }
})

const PHOTO = { look: { shape: 'squircle', color: '#6366f1', imageKind: 'photo' } } as const
const FINISHED = { name: 'dev', complete: true, steps: {}, needsModel: false }
const hide = () => screen.getByRole('switch', { name: 'Hide from the list' })
const upload = () => fireEvent.change(screen.getByLabelText('Upload photo'), { target: { files: [new File([new Uint8Array(5)], 'a.png', { type: 'image/png' })] } })
const finishCalls = (fn: ReturnType<typeof stub>) => fn.mock.calls.filter(([u]) => u === '/crew/bots/dev/finish')
const finishBody = (fn: ReturnType<typeof stub>) => JSON.parse(String(finishCalls(fn)[0]?.[1]?.body)) as unknown
/** A photo the browser can "prepare": jsdom has no canvas or image decoder. */
function stubCanvas(): void {
  vi.stubGlobal('createImageBitmap', vi.fn(() => Promise.resolve({ width: 10, height: 10, close: vi.fn() })))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  toast.success.mockClear()
  clearProfileDrafts()
})

describe('profile Advanced tab', () => {
  it('lists Approvals, Computer, Sandbox, Hide and Danger zone, with Sandbox in a section of its own', async () => {
    stub()
    open(dev(), 'advanced')
    await loaded()
    await screen.findByRole('heading', { name: 'Sandbox' })
    expect(screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['Approvals', 'Computer', 'Sandbox', 'Hide', 'Danger zone'])
    // sandbox.spec.ts finds the section by its heading: no other <section> may hold it.
    const holders = [...document.querySelectorAll('section')].filter(s => within(s).queryByRole('heading', { name: 'Sandbox' }))
    expect(holders).toHaveLength(1)
    expect(within(holders[0]!).getByRole('switch', { name: "Run Dev's tools in a sandbox" })).toBeInTheDocument()
    expect(screen.getByText('Changes here apply at once.')).toBeInTheDocument()
  })

  it('hides the bot at once and shows what was re-read', async () => {
    let hidden = false
    const fn = stub({
      get: () => json(detail({ hidden })),
      patch: body => {
        hidden = (body as { hidden: boolean }).hidden
        return json({ status: 'saved', detail: detail({ hidden }) })
      }
    })
    open(dev(), 'advanced')
    await loaded()
    fireEvent.click(hide())
    await waitFor(() => expect(patches(fn)).toEqual([{ hidden: true }]))
    await waitFor(() => expect(hide()).toHaveAttribute('aria-checked', 'true'))
    expect(toast.success).toHaveBeenCalledWith('Bot hidden')
    await waitFor(() => expect(hide()).toBeEnabled())
    fireEvent.click(hide())
    await waitFor(() => expect(patches(fn)).toEqual([{ hidden: true }, { hidden: false }]))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Bot shown'))
  })

  it('shows an error when hiding fails', async () => {
    stub({ patch: () => json({ error: 'hermes_error', message: 'ui_meta is locked' }, 502) })
    open(dev(), 'advanced')
    await loaded()
    fireEvent.click(hide())
    expect(await screen.findByRole('alert')).toHaveTextContent('ui_meta is locked')
    await waitFor(() => expect(hide()).toBeEnabled())
    expect(hide()).toHaveAttribute('aria-checked', 'false')
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('keeps the original baseline for a field edited here and changed elsewhere', async () => {
    let current = detail()
    const fn = stub({
      get: () => json(current),
      patch: body => {
        if ((body as { hidden?: boolean }).hidden) current = detail({ hidden: true, soul: 'Their soul' })
        return json({ status: 'saved', detail: current })
      }
    })
    open(dev(), 'soul')
    await loaded()
    change('Persona (SOUL.md)', 'Mine')
    goTab('Advanced')
    fireEvent.click(hide())
    await waitFor(() => expect(hide()).toHaveAttribute('aria-checked', 'true'))
    goTab('Soul')
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Mine')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ soul: 'Mine', baseline: { soul: 'Be nice' } })
  })

  it('delete requires the typed handle and goes home', async () => {
    const fn = stub()
    open(dev(), 'advanced')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Delete bot' }))
    expect(screen.getByText(/permanently removes @dev's chats, routines, memory and files/)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Type dev to confirm'), { target: { value: 'de' } })
    expect(confirm).toBeDisabled()
    expect(fn.mock.calls.some(([, i]) => i?.method === 'DELETE')).toBe(false)
    fireEvent.change(screen.getByLabelText('Type dev to confirm'), { target: { value: 'dev' } })
    expect(confirm).toBeEnabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(where()).toBe('/'))
    expect(fn.mock.calls.some(([u, i]) => u === '/crew/bots/dev' && i?.method === 'DELETE')).toBe(true)
  })

  it('forgets the unsaved edits of a bot that was deleted', async () => {
    stub()
    const first = open()
    await loaded()
    change('Name', 'Dev Two')
    goTab('Advanced')
    fireEvent.click(screen.getByRole('button', { name: 'Delete bot' }))
    fireEvent.change(screen.getByLabelText('Type dev to confirm'), { target: { value: 'dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(where()).toBe('/'))
    first.unmount()
    // A new bot that takes the same handle starts clean.
    open()
    await loaded()
    expect(screen.getByLabelText('Name')).toHaveValue('Dev')
    expect(saveButton()).toBeNull()
  })

  it('explains a sandbox cleanup failure when deleting', async () => {
    stub({ del: () => json({ error: 'sandbox_cleanup_failed' }, 409) })
    open(dev(), 'advanced')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Delete bot' }))
    fireEvent.change(screen.getByLabelText('Type dev to confirm'), { target: { value: 'dev' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText("Crew couldn't remove Dev's sandbox files. Start Docker, or download the sandbox image again, then try again.")).toBeInTheDocument()
    expect(where()).toBe('/bots/dev?panel=profile&tab=advanced')
  })

  it('protects the primary: no delete, no use-screen switch, approvals and sleep read-only with the reason', async () => {
    const fn = stub({ get: () => json(detail({ name: 'default', isPrimary: true, title: 'Hermes' })) })
    open(dev({ name: 'default', title: 'Hermes', isPrimary: true }), 'advanced')
    await loaded()
    await waitFor(() => expect(screen.getAllByRole('radio').filter(r => (r as HTMLInputElement).checked)).toHaveLength(2))
    expect(screen.queryByRole('button', { name: 'Delete bot' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Danger zone' })).toBeNull()
    expect(screen.queryByRole('switch', { name: /use its screen/ })).toBeNull()
    for (const input of screen.getAllByRole('radio')) expect(input).toBeDisabled()
    expect(screen.getAllByText("New bots copy Hermes's settings, so change these in Hermes")).toHaveLength(2)
    fireEvent.click(screen.getByRole('radio', { name: /^Never ask/ }))
    fireEvent.click(screen.getByRole('radio', { name: 'Never' }))
    expect(puts(fn, 'approvals')).toEqual([])
    expect(puts(fn, 'screen/config')).toEqual([])
    // No Hide for the primary: it never leaves the rail, so the switch would only drop it from the count and the group picker.
    expect(screen.queryByRole('switch', { name: 'Hide from the list' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'Hide' })).toBeNull()
    goTab('Identity')
    expect(within(screen.getByRole('tabpanel')).getByText('@hermes')).toBeInTheDocument()
  })
})

describe('profile Apps tab', () => {
  it("hosts the bot's apps", async () => {
    stub()
    open(dev(), 'apps')
    await loaded()
    expect(await screen.findByRole('heading', { name: 'Apps' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sandbox' })).toBeNull()
  })
})

describe('profile Avatar tab', () => {
  it('removes a photo at once', async () => {
    const fn = stub({ get: () => json(detail(PHOTO)), other: { 'DELETE /crew/bots/dev/avatar': () => json(detail()) } })
    open(dev(), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => u === '/crew/bots/dev/avatar' && i?.method === 'DELETE')).toBe(true))
  })

  it('shows the picker only on its own tab', async () => {
    stub()
    open()
    await loaded()
    expect(screen.queryByRole('button', { name: 'ghost' })).toBeNull()
    goTab('Avatar')
    expect(screen.getByRole('button', { name: 'ghost' })).toBeVisible()
    expect(screen.queryByLabelText('Name')).toBeNull()
  })

  it("does not revert another app's edit after a photo refresh", async () => {
    const fn = stub({ get: () => json(detail(PHOTO)), other: { 'DELETE /crew/bots/dev/avatar': () => json(detail({ soul: 'Their soul' })) } })
    open(dev(), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Remove photo' }))
    goTab('Soul')
    await waitFor(() => expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Their soul'))
    goTab('Identity')
    change('Name', 'Dev Two')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ title: 'Dev Two' })
  })

  it('saves a picked type immediately with PATCH {avatar}, keeping the stored colour', async () => {
    const stored = detail({ avatar: { type: 'cat', color: '#7c5cff' } })
    const fn = stub({ get: () => json(stored), patch: () => json({ status: 'saved', detail: stored }) })
    open(dev(), 'avatar')
    await loaded()
    expect(screen.getByRole('button', { name: 'cat' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    await waitFor(() => expect(patches(fn)).toEqual([{ avatar: { type: 'ghost', color: '#7c5cff' } }]))
  })

  it('saves Default as a type with no colour, and a swatch as its hex', async () => {
    const stored = detail({ avatar: { type: 'cat', color: '#7c5cff' } })
    const fn = stub({ get: () => json(stored), patch: () => json({ status: 'saved', detail: stored }) })
    open(dev(), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ avatar: { type: 'cat' } })
    fireEvent.click(screen.getByRole('button', { name: 'Teal' }))
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ avatar: { type: 'cat', color: '#2ec4c4' } })
  })

  it('does not send guarded fields or baselines with an avatar pick, and shows no save bar', async () => {
    const fn = stub()
    open(dev(), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }))
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ avatar: { type: deriveAvatarType('dev'), color: '#4aa8ff' } })
    expect(saveButton()).toBeNull()
  })

  it('holds a second pick back until the first save is done, so it keeps the first pick', async () => {
    let release: (v: Response) => void = () => undefined
    const stored = detail({ avatar: { type: 'cat' } })
    const fn = stub({ get: () => json(stored), patch: () => new Promise<Response>(resolve => { release = resolve }) })
    open(dev(), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Teal' }))
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'ghost' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    expect(patches(fn)).toHaveLength(1)
    release(new Response(JSON.stringify({ status: 'saved', detail: detail({ avatar: { type: 'cat', color: '#2ec4c4' } }) })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'ghost' })).toBeEnabled())
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('keeps Save off until a photo upload has finished, on any tab', async () => {
    let release: (v: Response) => void = () => undefined
    stubCanvas()
    const fn = stub({ other: { 'PUT /crew/bots/dev/avatar': () => new Promise<Response>(resolve => { release = resolve }) } })
    open()
    await loaded()
    change('Name', 'Dev Two')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    goTab('Avatar')
    upload()
    await waitFor(() => expect(screen.getByLabelText('Upload photo')).toBeDisabled())
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    // Leaving the tab does not free Save: the upload is still on its way, and ⌘↵ waits too.
    goTab('Identity')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Enter', metaKey: true })
    expect(patches(fn)).toHaveLength(0)
    release(new Response(JSON.stringify(detail(PHOTO))))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
  })

  it('says "photo" when a photo change fails', async () => {
    stubCanvas()
    stub({ other: { 'PUT /crew/bots/dev/avatar': () => json({ error: 'hermes_error' }, 502) } })
    open(dev(), 'avatar')
    await loaded()
    upload()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not change the photo. Try again.')
  })

  it('locks the picker while a photo is being prepared', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(() => undefined)))
    stub()
    open(dev(), 'avatar')
    await loaded()
    upload()
    await screen.findByText('Preparing photo…')
    expect(screen.getByRole('button', { name: 'ghost' })).toBeDisabled()
  })
})

describe('profile avatar picks while setup is unfinished', () => {
  const unfinished = () => dev({ setupIncomplete: true })

  it('finishes with the name and the derived avatar when nothing was picked', async () => {
    const fn = stub({ other: { 'POST /crew/bots/dev/finish': () => json(FINISHED) } })
    open(unfinished())
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    await waitFor(() => expect(finishCalls(fn)).toHaveLength(1))
    expect(finishBody(fn)).toEqual({ title: 'Dev', avatar: { type: deriveAvatarType('dev') } })
  })

  it('holds picks locally for an unfinished bot and sends them with Finish setup, from any tab', async () => {
    const fn = stub({ other: { 'POST /crew/bots/dev/finish': () => json(FINISHED) } })
    open(unfinished(), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    fireEvent.click(screen.getByRole('button', { name: 'Teal' }))
    expect(patches(fn)).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'ghost' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true')
    // The held pick outlives a tab switch and comes back as picked.
    goTab('Soul')
    goTab('Avatar')
    expect(screen.getByRole('button', { name: 'ghost' })).toHaveAttribute('aria-pressed', 'true')
    goTab('Advanced')
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    await waitFor(() => expect(finishCalls(fn)).toHaveLength(1))
    expect(finishBody(fn)).toEqual({ title: 'Dev', avatar: { type: 'ghost', color: '#2ec4c4' } })
  })

  it('sends a held pick once when another save ends setup before Finish, even from another tab', async () => {
    const fn = stub({ patch: () => json({ status: 'saved', detail: detail({ avatar: { type: 'ghost', color: '#2ec4c4' } }) }) })
    const { rerender } = open(unfinished(), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    fireEvent.click(screen.getByRole('button', { name: 'Teal' }))
    expect(patches(fn)).toHaveLength(0)
    goTab('Identity')
    rerender(tree(dev({ setupIncomplete: false })))
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ avatar: { type: 'ghost', color: '#2ec4c4' } })
    goTab('Avatar')
    await waitFor(() => expect(screen.getByRole('button', { name: 'ghost' })).toBeEnabled())
    expect(patches(fn)).toHaveLength(1)
  })

  it('keeps a held pick and sends it with Finish setup after a failed photo upload', async () => {
    stubCanvas()
    const fn = stub({ other: {
      'PUT /crew/bots/dev/avatar': () => json({ error: 'hermes_error' }, 502),
      'POST /crew/bots/dev/finish': () => json(FINISHED)
    } })
    open(unfinished(), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    fireEvent.click(screen.getByRole('button', { name: 'Teal' }))
    upload()
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not change the photo. Try again.')
    expect(screen.getByRole('button', { name: 'ghost' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    await waitFor(() => expect(finishCalls(fn)).toHaveLength(1))
    expect(finishBody(fn)).toEqual({ title: 'Dev', avatar: { type: 'ghost', color: '#2ec4c4' } })
  })

  it('waits for an in-flight save before sending a held pick when setup ends', async () => {
    stubCanvas()
    let release: (v: Response) => void = () => undefined
    const fn = stub({
      patch: () => json({ status: 'saved', detail: detail({ avatar: { type: 'ghost' } }) }),
      other: { 'PUT /crew/bots/dev/avatar': () => new Promise<Response>(resolve => { release = resolve }) }
    })
    const { rerender } = open(unfinished(), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    upload()
    await waitFor(() => expect(screen.getByRole('button', { name: 'ghost' })).toBeDisabled())
    await waitFor(() => expect(fn.mock.calls.some(([u, i]) => u === '/crew/bots/dev/avatar' && i?.method === 'PUT')).toBe(true))
    rerender(tree(dev({ setupIncomplete: false }), 'avatar'))
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(patches(fn)).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'ghost' })).toBeDisabled()
    release(new Response(JSON.stringify(detail(PHOTO))))
    await waitFor(() => expect(patches(fn)).toEqual([{ avatar: { type: 'ghost' } }]))
    await waitFor(() => expect(screen.getByRole('button', { name: 'ghost' })).toBeEnabled())
  })
})
