import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deriveAvatarType } from '@/features/avatars/avatar-model'
import { describeCreateFailure } from '@/features/bots/create-errors'
import { CrewApiError } from '@/features/bots/bots-api'
import { NewBotDialog } from '@/features/bots/NewBotDialog'
import type { CreateResult } from '@/features/bots/types'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-type={String(props.type)} /> }
})

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const complete: CreateResult = { name: 'research-bot', complete: true, steps: { profile: 'ok', look: 'ok', avatar: 'skipped', chat: 'ok', sandbox: 'skipped' }, needsModel: false }
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
const setup = (onCreated = vi.fn(), onOpenChange = vi.fn()) => {
  render(<NewBotDialog open onOpenChange={onOpenChange} onCreated={onCreated} />)
  return { onCreated, onOpenChange }
}

afterEach(() => vi.unstubAllGlobals())

describe('NewBotDialog', () => {
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
    const { onCreated, onOpenChange } = setup()
    type('Name', 'Research Bot')
    type('Job & personality', 'Find things')
    fireEvent.click(screen.getByRole('button', { name: 'Violet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('research-bot'))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(JSON.parse(String(call(fn, '/crew/bots')?.[1]?.body))).toEqual({
      name: 'research-bot', title: 'Research Bot', mission: 'Find things', avatar: { type: deriveAvatarType('research-bot'), color: '#7c5cff' }, sandbox: false
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
