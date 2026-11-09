import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SettingsDialog } from '@/features/settings/SettingsDialog'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))

function stubFetch(put: (init: RequestInit) => Promise<Response>) {
  const fn = vi.fn((url: string, init?: RequestInit) =>
    url === '/crew/settings' ? put(init ?? {}) : json({ state: 'ok', limit: 5, used: 3, remaining: 2, checkedAt: 1 })
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

afterEach(() => vi.unstubAllGlobals())

const open = (value: number | null = 2, onOpenChange = vi.fn()) =>
  render(<SettingsDialog open onOpenChange={onOpenChange} maxWorkingBots={value} usage={{ state: 'ok', remaining: 2 }} />)

describe('SettingsDialog', () => {
  it('shows the current limit, the credit helper and the credit line', async () => {
    stubFetch(() => json({ maxWorkingBots: 2 }))
    open(3)
    expect(screen.getByLabelText('Bots working at the same time')).toHaveValue('3')
    expect(screen.getByText('Each working bot spends credit.')).toBeInTheDocument()
    expect(screen.getByText('$2.00 credit left')).toBeInTheDocument()
  })

  it('saves the chosen limit', async () => {
    const fetchFn = stubFetch(() => json({ maxWorkingBots: null }))
    const onOpenChange = vi.fn()
    open(2, onOpenChange)
    fireEvent.change(screen.getByLabelText('Bots working at the same time'), { target: { value: 'none' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
    const call = fetchFn.mock.calls.find(([url]) => url === '/crew/settings')
    expect(call?.[1]?.method).toBe('PUT')
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ maxWorkingBots: null })
  })

  it('saves a number', async () => {
    const fetchFn = stubFetch(() => json({ maxWorkingBots: 6 }))
    open(2)
    fireEvent.change(screen.getByLabelText('Bots working at the same time'), { target: { value: '6' } })
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
  })
})
