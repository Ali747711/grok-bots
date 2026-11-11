import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DeleteBotDialog } from '@/features/bots/DeleteBotDialog'

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }))
const stub = (reply: () => Promise<Response>) => {
  const fn = vi.fn((_url: string, _init?: RequestInit) => reply())
  vi.stubGlobal('fetch', fn)
  return fn
}
const show = (onOpenChange = vi.fn(), onDeleted = vi.fn()) => {
  render(<DeleteBotDialog name="dev" title="Dev" open onOpenChange={onOpenChange} onDeleted={onDeleted} />)
  return { onOpenChange, onDeleted }
}
const typed = (value: string) => fireEvent.change(screen.getByLabelText('Type dev to confirm'), { target: { value } })

afterEach(() => vi.unstubAllGlobals())

describe('DeleteBotDialog', () => {
  it('is an alert dialog titled in the panel-title size, with the handle field as a row label', () => {
    show()
    expect(screen.getByRole('alertdialog', { name: 'Delete Dev?' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Delete Dev?' })).toHaveClass('text-[15px]', 'font-semibold')
    expect(screen.getByText('Type dev to confirm')).toHaveClass('text-[13px]', 'font-semibold')
    expect(screen.getByText("This permanently removes @dev's chats, routines, memory and files.")).toHaveClass('text-[13px]')
  })

  it('keeps Delete off until the handle is typed exactly, then deletes once and closes', async () => {
    const fn = stub(() => Promise.resolve(new Response(null, { status: 204 })))
    const { onOpenChange, onDeleted } = show()
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toBeDisabled()
    typed('Dev')
    expect(confirm).toBeDisabled()
    typed('dev')
    fireEvent.click(confirm)
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(fn.mock.calls.filter(([u, i]) => u === '/crew/bots/dev' && i?.method === 'DELETE')).toHaveLength(1)
  })

  it('Cancel closes without deleting', () => {
    const fn = stub(() => json({}))
    const { onOpenChange, onDeleted } = show()
    typed('dev')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    expect(onDeleted).not.toHaveBeenCalled()
    expect(fn).not.toHaveBeenCalled()
  })

  it('shows sandbox_cleanup_failed as plain red text, never on a red tint, and stays open', async () => {
    stub(() => json({ error: 'sandbox_cleanup_failed' }, 409))
    const { onOpenChange, onDeleted } = show()
    typed('dev')
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Crew couldn't remove Dev's sandbox files. Start Docker, or download the sandbox image again, then try again.")
    expect(alert).toHaveClass('text-destructive', 'text-[13px]')
    expect(alert.className).not.toMatch(/bg-destructive/)
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('the Delete button is the neutral destructive button: red text on a raised fill', () => {
    show()
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toHaveClass('bg-raised', 'text-destructive')
    expect(confirm.className).not.toMatch(/bg-destructive/)
  })
})
