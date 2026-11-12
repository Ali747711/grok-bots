import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmAction } from '@/features/triggers/ConfirmAction'

const show = (over: Partial<Parameters<typeof ConfirmAction>[0]> = {}) => {
  const props = { open: true, title: 'Make a new secret?', description: 'The old one stops working.', confirm: 'Make new secret', busy: false, onConfirm: vi.fn(), onOpenChange: vi.fn(), ...over }
  render(<ConfirmAction {...props} />)
  return props
}

describe('ConfirmAction', () => {
  it('is an alert dialog with the title in the panel-title size and a 13 px description', () => {
    show()
    expect(screen.getByRole('alertdialog', { name: 'Make a new secret?' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Make a new secret?' })).toHaveClass('text-[15px]', 'font-semibold')
    expect(screen.getByText('The old one stops working.')).toHaveClass('text-[13px]', 'font-medium')
  })

  it('confirms, cancels, and holds the confirm button while busy', () => {
    const props = show()
    fireEvent.click(screen.getByRole('button', { name: 'Make new secret' }))
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })

  it('holds the confirm button while it works', () => {
    show({ busy: true })
    expect(screen.getByRole('button', { name: 'Make new secret' })).toBeDisabled()
  })

  it('a destructive confirm is red text on a raised fill, never on a red tint; Cancel is the quiet button', () => {
    show({ destructive: true, confirm: 'Delete' })
    const confirm = screen.getByRole('button', { name: 'Delete' })
    expect(confirm).toHaveClass('bg-raised', 'text-destructive')
    expect(confirm.className).not.toMatch(/bg-destructive/)
    expect(screen.getByRole('button', { name: 'Cancel' }).className).not.toMatch(/border-border/)
  })
})
