import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deriveAvatarType } from '@/features/avatars/avatar-model'
import { describeCreateFailure } from '@/features/bots/create-errors'
import { CrewApiError } from '@/features/bots/bots-api'
import type { CreateResult } from '@/features/bots/types'
import { NewBotDisclosure } from '@/features/rail/NewBotDisclosure'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-type={String(props.type)} /> }
})

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const complete: CreateResult = { name: 'research-bot', complete: true, steps: { profile: 'ok', apps: 'ok', look: 'ok', avatar: 'skipped', chat: 'ok', sandbox: 'skipped' }, needsModel: false }
const incomplete: CreateResult = {
  ...complete, complete: false, steps: { ...complete.steps, look: 'failed' }, error: { step: 'look', message: 'boom' }
}
const MODELS = { providers: [{ slug: 'openrouter', name: 'OpenRouter', is_current: true, models: ['a/one', 'b/two'] }], model: 'a/one', provider: 'openrouter' }

function stub(create: () => Promise<Response>, finish: () => Promise<Response> = () => json(complete)) {
  const fn = vi.fn((url: string, _init?: RequestInit) => {
    if (url === '/api/model/options') return json(MODELS)
    if (url === '/crew/bots') return create()
    if (url.endsWith('/finish')) return finish()
    return json({})
  })
  vi.stubGlobal('fetch', fn)
  return fn
}
const call = (fn: ReturnType<typeof stub>, url: string) => fn.mock.calls.find(([u]) => u === url)
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })
/** Base UI only commits an option click that started with a pointer-down on it. */
const pickModel = (option: string) => {
  fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
  const item = screen.getByRole('option', { name: option })
  fireEvent.pointerDown(item)
  fireEvent.click(item)
}
const trigger = () => screen.getByRole('button', { name: '+ New bot' })
const panel = () => screen.getByRole('dialog', { name: 'New bot' })
const openPanel = () => fireEvent.click(trigger())
/** Renders the disclosure and opens its panel. */
const setup = (onCreated = vi.fn()) => {
  render(<NewBotDisclosure onCreated={onCreated} />)
  openPanel()
  return { onCreated }
}
/** A press that starts and ends outside the panel, as Base UI's dismiss sees it. */
const pressOutside = () => {
  fireEvent.pointerDown(document.body)
  fireEvent.mouseDown(document.body)
  fireEvent.click(document.body)
}
/** Tab cannot move focus in jsdom; focus lands on the guard Base UI puts after (or before) the panel's controls. */
const tabPast = (edge: 'end' | 'start') => {
  const guards = [...document.querySelectorAll<HTMLElement>('[data-base-ui-focus-guard]')]
  const guard = edge === 'end' ? guards.at(-1) : guards[0]
  if (!guard) throw new Error('no focus guard')
  guard.focus()
}

afterEach(() => vi.unstubAllGlobals())

describe('NewBotDisclosure', () => {
  it('derives the handle from the name', () => {
    stub(() => json(complete, 201))
    setup()
    type('Name', 'Research Bot')
    expect(screen.getByText('@research-bot')).toBeInTheDocument()
  })

  it('blocks a reserved handle', () => {
    stub(() => json(complete, 201))
    setup()
    type('Name', 'default')
    expect(screen.getByText('That handle is reserved')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
  })

  it('lets the handle be changed and validates it', () => {
    stub(() => json(complete, 201))
    setup()
    type('Name', 'Research Bot')
    fireEvent.click(screen.getByRole('button', { name: 'Change handle' }))
    expect(screen.getByLabelText('Handle')).toHaveValue('research-bot')
    type('Handle', 'Bad Handle')
    expect(screen.getByText(/Use lowercase letters, numbers/)).toBeInTheDocument()
  })

  it('posts the draft and reports the created bot', async () => {
    const fn = stub(() => json(complete, 201))
    const { onCreated } = setup()
    type('Name', 'Research Bot')
    type('Job & personality', 'Find things')
    fireEvent.click(screen.getByRole('button', { name: 'Violet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('research-bot'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(JSON.parse(String(call(fn, '/crew/bots')?.[1]?.body))).toEqual({
      name: 'research-bot', title: 'Research Bot', mission: 'Find things', avatar: { type: deriveAvatarType('research-bot'), color: '#7c5cff' }, role: null, sandbox: false
    })
  })

  it('preselects the derived type for a new handle until the user picks one', () => {
    stub(() => json(complete, 201))
    setup()
    type('Name', 'Research Bot')
    expect(screen.getByRole('button', { name: deriveAvatarType('research-bot') })).toHaveAttribute('aria-pressed', 'true')
    type('Name', 'Other Bot')
    expect(screen.getByRole('button', { name: deriveAvatarType('other-bot') })).toHaveAttribute('aria-pressed', 'true')
    const picked = deriveAvatarType('research-bot') === 'cat' ? 'ghost' : 'cat'
    fireEvent.click(screen.getByRole('button', { name: picked }))
    type('Name', 'Third Bot')
    expect(screen.getByRole('button', { name: picked })).toHaveAttribute('aria-pressed', 'true')
  })

  it('posts the avatar in the new bot draft, with no look', async () => {
    const fn = stub(() => json(complete, 201))
    setup()
    type('Name', 'Research Bot')
    fireEvent.click(screen.getByRole('button', { name: 'cat' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(call(fn, '/crew/bots')).toBeDefined())
    const body = JSON.parse(String(call(fn, '/crew/bots')?.[1]?.body))
    expect(body.avatar).toEqual({ type: 'cat' })
    expect(body).not.toHaveProperty('look')
  })

  it('has one Name field that is also the display title', async () => {
    const fn = stub(() => json(complete, 201))
    setup()
    expect(screen.queryByLabelText('Title')).toBeNull()
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '80')
    type('Name', '  Smoke Scout  ')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(call(fn, '/crew/bots')).toBeDefined())
    const body = JSON.parse(String(call(fn, '/crew/bots')?.[1]?.body))
    expect(body.name).toBe('smoke-scout')
    expect(body.title).toBe('Smoke Scout')
  })

  it('keeps Create disabled while a photo is being prepared', async () => {
    stub(() => json(complete, 201))
    let release: (v: { width: number; height: number; close: () => void }) => void = () => undefined
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(resolve => { release = resolve })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA')
    setup()
    type('Name', 'Scout')
    expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    fireEvent.change(screen.getByLabelText('Upload photo'), { target: { files: [new File([new Uint8Array(5)], 'a.png', { type: 'image/png' })] } })
    expect(await screen.findByText('Preparing photo…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    release({ width: 10, height: 10, close: vi.fn() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled())
    expect(screen.queryByText('Preparing photo…')).toBeNull()
    vi.restoreAllMocks()
  })

  it('sends the chosen model with the current provider', async () => {
    const fn = stub(() => json(complete, 201))
    setup()
    type('Name', 'Scout')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled())
    pickModel('b/two')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(call(fn, '/crew/bots')).toBeDefined())
    expect(JSON.parse(String(call(fn, '/crew/bots')?.[1]?.body)).model).toEqual({ provider: 'openrouter', model: 'b/two' })
  })

  it('offers finish setup after a failed step', async () => {
    const fn = stub(() => json(incomplete, 201))
    const { onCreated } = setup()
    type('Name', 'Research Bot')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Created @research-bot, but look failed: boom')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('research-bot'))
    expect(call(fn, '/crew/bots/research-bot/finish')?.[1]?.method).toBe('POST')
    const finishBody = JSON.parse(String(call(fn, '/crew/bots/research-bot/finish')?.[1]?.body))
    expect(finishBody).toEqual({ avatar: { type: deriveAvatarType('research-bot') }, title: 'Research Bot' })
  })

  it('sends the chosen role again after a finished setup, and nothing more when no role was chosen', async () => {
    const fn = stub(() => json(incomplete, 201))
    const { onCreated } = setup()
    type('Name', 'Research Bot')
    fireEvent.click(screen.getByRole('radio', { name: 'Engineer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Finish setup' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('research-bot'))
    const patch = fn.mock.calls.find(([u, init]) => u === '/crew/bots/research-bot' && init?.method === 'PATCH')
    expect(JSON.parse(String(patch?.[1]?.body))).toEqual({ role: 'engineer' })
  })

  it('opens the half-made bot', async () => {
    stub(() => json(incomplete, 201))
    const { onCreated } = setup()
    type('Name', 'Research Bot')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Open bot' }))
    expect(onCreated).toHaveBeenCalledWith('research-bot')
  })

  it('says when the bot needs a model', async () => {
    stub(() => json({ ...incomplete, needsModel: true }, 201))
    setup()
    type('Name', 'Research Bot')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('This bot needs a model before it can reply')).toBeInTheDocument()
  })

  it("shows the server's handle error inline", async () => {
    stub(() => json({ error: 'name_taken' }, 409))
    setup()
    type('Name', 'Research Bot')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('That handle is taken')).toBeInTheDocument()
  })

  it('maps offline and a Hermes timeout to clear messages', async () => {
    stub(() => json({ error: 'hermes_offline' }, 503))
    setup()
    type('Name', 'Research Bot')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText('Hermes is offline')).toBeInTheDocument()
    stub(() => json({ error: 'hermes_error', message: 'x' }, 502))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    expect(await screen.findByText(/The bot may still have been created/)).toBeInTheDocument()
  })

  it('refuses an oversized photo before uploading', async () => {
    const fn = stub(() => json(complete, 201))
    setup()
    const big = new File([new Uint8Array(16 * 1024 * 1024)], 'big.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText('Upload photo'), { target: { files: [big] } })
    expect(await screen.findByText(/15 MB/)).toBeInTheDocument()
    expect(fn.mock.calls.filter(([u]) => u === '/crew/bots')).toHaveLength(0)
  })

  it('falls back to the default model with a note when models cannot load', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => (url === '/api/model/options' ? json({}, 500) : json({}))))
    setup()
    expect(await screen.findByText("Couldn't load models")).toBeInTheDocument()
  })

  it('W6: Finish setup waits for a photo that is still being prepared', async () => {
    stub(() => json(incomplete, 201))
    setup()
    type('Name', 'Research Bot')
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await screen.findByRole('button', { name: 'Finish setup' })
    let release: (v: { width: number; height: number; close: () => void }) => void = () => undefined
    vi.stubGlobal('createImageBitmap', vi.fn(() => new Promise(resolve => { release = resolve })))
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,AAAA')
    fireEvent.change(screen.getByLabelText('Upload photo'), { target: { files: [new File([new Uint8Array(5)], 'a.png', { type: 'image/png' })] } })
    await screen.findByText('Preparing photo…')
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeDisabled()
    release({ width: 10, height: 10, close: vi.fn() })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Finish setup' })).toBeEnabled())
    vi.restoreAllMocks()
  })

  describe('morph panel', () => {
    it('opens a dialog from + New bot and traps focus inside it', async () => {
      stub(() => json(complete, 201))
      render(<NewBotDisclosure onCreated={vi.fn()} />)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog')
      openPanel()
      await waitFor(() => expect(screen.getByLabelText('Name')).toHaveFocus())
      expect(panel()).toHaveClass('w-[440px]', 'max-h-[calc(100dvh-16px)]', 'overflow-hidden', 'rounded-3xl', 'bg-shell')
      // Light review I8: only the body scrolls; the title and Close sit above it and Create sticks to its bottom.
      const body = within(panel()).getByLabelText('Name').closest('.overflow-y-auto')
      expect(body).not.toBeNull()
      expect(body!.contains(within(panel()).getByRole('button', { name: 'Close' }))).toBe(false)
      expect(within(panel()).getByRole('button', { name: 'Create' }).parentElement).toHaveClass('sticky', 'bottom-0', 'bg-shell')
      type('Name', 'Scout')
      const controls = within(panel()).getAllByRole('button')
      const first = within(panel()).getByRole('button', { name: 'Close' })
      const last = within(panel()).getByRole('button', { name: 'Create' })
      expect(controls[0]).toBe(first)
      expect(controls.at(-1)).toBe(last)
      last.focus()
      tabPast('end')
      await waitFor(() => expect(first).toHaveFocus())
      tabPast('start')
      await waitFor(() => expect(last).toHaveFocus())
    })

    it('Esc and Close reset the draft; an outside click keeps it', async () => {
      stub(() => json(complete, 201))
      setup()
      type('Name', 'Scout')
      type('Job & personality', 'Finds things')
      fireEvent.click(screen.getByRole('radio', { name: 'Engineer' }))
      pressOutside()
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(trigger()).toHaveFocus())
      openPanel()
      expect(screen.getByLabelText('Name')).toHaveValue('Scout')
      expect(screen.getByLabelText('Job & personality')).toHaveValue('Finds things')
      expect(screen.getByRole('radio', { name: 'Engineer' })).toBeChecked()

      fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(trigger()).toHaveFocus())
      openPanel()
      expect(screen.getByLabelText('Name')).toHaveValue('')
      expect(screen.getByLabelText('Job & personality')).toHaveValue('')
      expect(screen.getByRole('radio', { name: 'None' })).toBeChecked()

      type('Name', 'Scout')
      fireEvent.click(within(panel()).getByRole('button', { name: 'Close' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await waitFor(() => expect(trigger()).toHaveFocus())
      openPanel()
      expect(screen.getByLabelText('Name')).toHaveValue('')
      expect(within(panel()).queryByRole('button', { name: 'Cancel' })).toBeNull()
    })

    it('sends the chosen role with the draft', async () => {
      const fn = stub(() => json(complete, 201))
      setup()
      type('Name', 'Scout')
      fireEvent.click(screen.getByRole('radio', { name: 'Engineer' }))
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(call(fn, '/crew/bots')).toBeDefined())
      expect(JSON.parse(String(call(fn, '/crew/bots')?.[1]?.body)).role).toBe('engineer')

      fn.mockClear()
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      openPanel()
      type('Name', 'Scout Two')
      fireEvent.click(screen.getByRole('radio', { name: 'Analyst' }))
      fireEvent.click(screen.getByRole('radio', { name: 'None' }))
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(call(fn, '/crew/bots')).toBeDefined())
      expect(JSON.parse(String(call(fn, '/crew/bots')?.[1]?.body)).role).toBeNull()
    })

    it('shows a partial result with Finish setup and Open bot inside the panel', async () => {
      stub(() => json({ ...incomplete, needsModel: true }, 201))
      const { onCreated } = setup()
      type('Name', 'Research Bot')
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      const inside = within(panel())
      expect(await inside.findByText('Created @research-bot, but look failed: boom')).toBeInTheDocument()
      expect(inside.getByText('This bot needs a model before it can reply')).toBeInTheDocument()
      expect(inside.getByRole('button', { name: 'Finish setup' })).toBeInTheDocument()
      expect(inside.queryByRole('button', { name: 'Create' })).toBeNull()
      expect(onCreated).not.toHaveBeenCalled()
      fireEvent.click(inside.getByRole('button', { name: 'Open bot' }))
      expect(onCreated).toHaveBeenCalledWith('research-bot')
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    })

    it('shows validation and server errors inside the panel', async () => {
      stub(() => json({ error: 'hermes_offline' }, 503))
      setup()
      type('Name', 'default')
      expect(within(panel()).getByText('That handle is reserved')).toBeInTheDocument()
      type('Name', 'Scout')
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      expect(await within(panel()).findByRole('alert')).toHaveTextContent('Hermes is offline')
    })

    it('starts a fresh draft after a half-made bot, even when the panel was closed by an outside click', async () => {
      stub(() => json(incomplete, 201))
      setup()
      type('Name', 'Research Bot')
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      await screen.findByRole('button', { name: 'Finish setup' })
      pressOutside()
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      openPanel()
      expect(screen.getByLabelText('Name')).toHaveValue('')
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
    })

    it('keeps every field label the e2e specs use', () => {
      stub(() => json(complete, 201))
      setup()
      expect(screen.getByLabelText('Name')).toBeInTheDocument()
      expect(screen.getByLabelText('Job & personality')).toBeInTheDocument()
      expect(screen.getByLabelText('Upload photo')).toBeInTheDocument()
      expect(screen.getByRole('combobox', { name: 'Model' })).toBeInTheDocument()
      expect(screen.getByRole('checkbox', { name: 'Run in a sandbox' })).toBeInTheDocument()
      expect(screen.getByRole('radiogroup', { name: 'Role' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'cat' })).toHaveAttribute('aria-pressed')
      expect(screen.getByRole('button', { name: 'Pink' })).toHaveAttribute('aria-pressed')
      expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
      type('Name', 'Scout')
      fireEvent.click(screen.getByRole('button', { name: 'Change handle' }))
      expect(screen.getByLabelText('Handle')).toHaveValue('scout')
    })
  })

  describe('sandbox choice', () => {
    const image = (over: Record<string, unknown> = {}) => ({ pulling: false, progress: null, error: null, image: 'x', docker: 'ok', present: true, ...over })
    function stubSandbox(img: Record<string, unknown>) {
      const fn = vi.fn((url: string, _init?: RequestInit) => {
        if (url === '/api/model/options') return json(MODELS)
        if (url === '/crew/sandbox/image') return json(image(img))
        if (url === '/crew/bots') return json(complete, 201)
        return json({})
      })
      vi.stubGlobal('fetch', fn)
      return fn
    }
    const box = () => screen.getByRole('checkbox', { name: 'Run in a sandbox' })

    it('creates a sandboxed bot when Run in a sandbox is ticked', async () => {
      const fn = stubSandbox({})
      setup()
      type('Name', 'Scout')
      expect(box()).not.toBeChecked()
      fireEvent.click(box())
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled())
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(call(fn, '/crew/bots')).toBeDefined())
      expect(JSON.parse(String(call(fn, '/crew/bots')?.[1]?.body)).sandbox).toBe(true)
    })

    it('sends sandbox false when unticked', async () => {
      const fn = stubSandbox({})
      setup()
      type('Name', 'Scout')
      fireEvent.click(screen.getByRole('button', { name: 'Create' }))
      await waitFor(() => expect(call(fn, '/crew/bots')).toBeDefined())
      expect(JSON.parse(String(call(fn, '/crew/bots')?.[1]?.body)).sandbox).toBe(false)
    })

    it('says why when the image status fails and keeps Create off', async () => {
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        if (url === '/api/model/options') return json(MODELS)
        if (url === '/crew/sandbox/image') return json({}, 500)
        return json({})
      }))
      setup()
      type('Name', 'Scout')
      fireEvent.click(box())
      expect(await screen.findByText("Couldn't change the sandbox. Try again.")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    })

    it('offers the download first when the image is missing and keeps Create off', async () => {
      stubSandbox({ present: false })
      setup()
      type('Name', 'Scout')
      fireEvent.click(box())
      expect(await screen.findByText("The sandbox image isn't downloaded")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Download (about 1.2 GB)' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
      fireEvent.click(box())
      expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled()
    })

    it('enables Create once the download finishes, without unticking', async () => {
      let phase: 'missing' | 'pulling' | 'present' = 'missing'
      vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
        if (url === '/api/model/options') return json(MODELS)
        if (url === '/crew/sandbox/image/pull' && init?.method === 'POST') { phase = 'pulling'; return json(image({ present: false, pulling: true }), 202) }
        if (url === '/crew/sandbox/image') {
          if (phase === 'pulling') phase = 'present'
          return json(image({ present: phase === 'present', pulling: false }))
        }
        return json({})
      }))
      setup()
      type('Name', 'Scout')
      fireEvent.click(box())
      fireEvent.click(await screen.findByRole('button', { name: 'Download (about 1.2 GB)' }))
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
      await waitFor(() => expect(screen.getByRole('button', { name: 'Create' })).toBeEnabled(), { timeout: 4000 })
    })

    it("says Docker isn't available and keeps Create off", async () => {
      stubSandbox({ docker: 'missing', present: false })
      setup()
      type('Name', 'Scout')
      fireEvent.click(box())
      expect(await screen.findByText("Docker isn't available on this computer")).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    })

    it('shows the create refusal codes in words', () => {
      const refuse = (code: string) => describeCreateFailure(new CrewApiError(409, { error: code }))
      expect(refuse('docker_unavailable')).toEqual({ general: "Docker isn't available on this computer" })
      expect(refuse('image_missing')).toEqual({ general: "The sandbox image isn't downloaded" })
      expect(refuse('other')).toEqual({ general: 'That bot is still being created. Wait a moment.' })
    })
  })
})
