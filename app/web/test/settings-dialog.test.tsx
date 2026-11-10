import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('sonner', () => ({ toast }))

import { SettingsDialog } from '@/features/settings/SettingsDialog'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

function stubFetch(put: (init: RequestInit) => Promise<Response>, key: (init: RequestInit) => Promise<Response> = () => json({ configured: false })) {
  const fn = vi.fn((url: string, init?: RequestInit) =>
    url === '/crew/settings' ? put(init ?? {})
      : url === '/crew/connectors/key' ? key(init ?? {})
        : json({ state: 'ok', limit: 5, used: 3, remaining: 2, checkedAt: 1 })
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => {
  vi.unstubAllGlobals()
  toast.success.mockClear()
})

const limitBox = () => screen.getByRole('combobox', { name: 'Bots working at the same time' })
const choose = (name: string) => {
  fireEvent.click(limitBox())
  // Base UI only commits an item click that started with a pointer-down on it.
  const option = screen.getByRole('option', { name })
  fireEvent.pointerDown(option)
  fireEvent.click(option)
}

const open = (value: number | null = 2, onOpenChange = vi.fn()) =>
  render(<SettingsDialog open onOpenChange={onOpenChange} maxWorkingBots={value} usage={{ state: 'ok', remaining: 2 }} />)

describe('SettingsDialog', () => {
  it('shows the current limit, the credit helper and the credit line', async () => {
    stubFetch(() => json({ maxWorkingBots: 2 }))
    open(3)
    expect(limitBox()).toHaveTextContent('3')
    expect(screen.getByText('Each working bot spends credit.')).toBeInTheDocument()
    expect(screen.getByText('$2.00 credit left')).toBeInTheDocument()
  })

  it('saves the chosen limit', async () => {
    const fetchFn = stubFetch(() => json({ maxWorkingBots: null }))
    const onOpenChange = vi.fn()
    open(2, onOpenChange)
    choose('No limit')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    expect(toast.success).toHaveBeenCalledWith('Settings saved')
    const call = fetchFn.mock.calls.find(([url]) => url === '/crew/settings')
    expect(call?.[1]?.method).toBe('PUT')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ maxWorkingBots: null })
  })

  it('saves a number', async () => {
    const fetchFn = stubFetch(() => json({ maxWorkingBots: 6 }))
    open(2)
    choose('6')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(fetchFn.mock.calls.some(([url]) => url === '/crew/settings')).toBe(true))
    const call = fetchFn.mock.calls.find(([url]) => url === '/crew/settings')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ maxWorkingBots: 6 })
  })

  it('shows an error and stays open when saving fails', async () => {
    stubFetch(() => json({ error: 'bad_body' }, 400))
    const onOpenChange = vi.fn()
    open(2, onOpenChange)
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/could not save/i)
    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('Composio key row', () => {
  const keyInput = () => screen.getByLabelText('Composio API key') as HTMLInputElement

  it('shows Not set, saves a key and shows Saved without ever showing the key', async () => {
    let saved = false
    const fetchFn = stubFetch(() => json({}), init => {
      if (init.method === 'PUT') { saved = true; return json({ configured: true }) }
      return json({ configured: saved })
    })
    open()
    expect(await screen.findByText('Not set')).toBeInTheDocument()
    expect(keyInput().type).toBe('password')
    expect(keyInput().value).toBe('')
    fireEvent.change(keyInput(), { target: { value: 'ak_test_key_123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Key saved'))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(keyInput().value).toBe('')
    expect(document.body.textContent).not.toContain('ak_test_key_123')
    const put = fetchFn.mock.calls.find(([, i]) => i?.method === 'PUT' && i.body !== undefined)
    expect(JSON.parse(String(put?.[1]?.body))).toEqual({ key: 'ak_test_key_123' })
  })

  it('shows Key not accepted for a rejected key', async () => {
    stubFetch(() => json({}), init => (init.method === 'PUT' ? json({ error: 'key_rejected' }, 409) : json({ configured: false })))
    open()
    await screen.findByText('Not set')
    fireEvent.change(keyInput(), { target: { value: 'ak_test_key_123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Key not accepted')
    expect(keyInput().value).toBe('')
    expect(toast.success).not.toHaveBeenCalledWith('Key saved')
  })

  it('removes the key after the confirmation', async () => {
    let removed = false
    stubFetch(() => json({}), init => {
      if (init.method === 'DELETE') { removed = true; return Promise.resolve(new Response(null, { status: 204 })) }
      return json({ configured: !removed })
    })
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove key' }))
    expect(await screen.findByText('Remove the Composio key?')).toBeInTheDocument()
    expect(screen.getByText('Bots keep their app settings but lose their app tools until you save a key again.')).toBeInTheDocument()
    const buttons = screen.getAllByRole('button', { name: 'Remove key' })
    fireEvent.click(buttons[buttons.length - 1]!)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Key removed'))
    expect(await screen.findByText('Not set')).toBeInTheDocument()
  })

  const saveWith = async (reply: Promise<Response>) => {
    stubFetch(() => json({}), init => (init.method === 'PUT' ? reply : json({ configured: false })))
    open()
    await screen.findByText('Not set')
    fireEvent.change(keyInput(), { target: { value: 'ak_test_key_123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    return screen.findByRole('alert')
  }

  it('says That doesn\'t look like a Composio key. for a 400', async () => {
    expect(await saveWith(json({ error: 'bad_body' }, 400))).toHaveTextContent("That doesn't look like a Composio key.")
  })

  it('says Hermes is offline for a 503 on Save', async () => {
    expect(await saveWith(json({ error: 'hermes_offline' }, 503))).toHaveTextContent('Hermes is offline')
  })

  it('says Couldn\'t save the key. Try again. for anything else on Save', async () => {
    expect(await saveWith(json({ error: 'composio_unavailable' }, 502))).toHaveTextContent("Couldn't save the key. Try again.")
  })

  it('says Couldn\'t remove the key. Try again. when Remove fails', async () => {
    stubFetch(() => json({}), init => (init.method === 'DELETE' ? json({ error: 'apps_failed' }, 502) : json({ configured: true })))
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Remove key' }))
    const buttons = await screen.findAllByRole('button', { name: 'Remove key' })
    fireEvent.click(buttons[buttons.length - 1]!)
    expect(await screen.findByText("Couldn't remove the key. Try again.")).toBeInTheDocument()
  })
})
