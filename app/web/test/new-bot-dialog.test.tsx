import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { NewBotDialog } from '@/features/bots/NewBotDialog'
import type { CreateResult } from '@/features/bots/types'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const complete: CreateResult = { name: 'research-bot', complete: true, steps: { profile: 'ok', look: 'ok', avatar: 'skipped', chat: 'ok' }, needsModel: false }
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
      name: 'research-bot', title: 'Research Bot', mission: 'Find things', look: { shape: 'squircle', color: '#7c3aed' }
    })
  })

  it('sends the chosen model with the current provider', async () => {
    const fn = stub(() => json(complete, 201))
    setup()
    type('Name', 'Scout')
    await screen.findByRole('option', { name: 'b/two' })
    type('Model', 'b/two')
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
})
