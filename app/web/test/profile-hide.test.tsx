import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearProfileDrafts } from '@/features/profile/profile-drafts'
import { UNCONFIRMED } from '@/features/profile/use-profile-row-action'

import { detail, dev, json, loaded, open, patches, stub } from './profile-harness'

const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-type={String(props.type)} /> }
})

const hide = () => screen.getByRole('switch', { name: 'Hide from the list' })
const OFFLINE = () => json({ error: 'hermes_offline' }, 503)
/** The bot is read once; every later read fails. */
const readOnce = () => {
  let reads = 0
  return () => (reads++ === 0 ? json(detail()) : OFFLINE())
}

afterEach(() => {
  vi.unstubAllGlobals()
  toast.success.mockClear()
  clearProfileDrafts()
})

describe('profile Hide row when the bot cannot be read again', () => {
  it('keeps the written switch and says it could not be re-checked', async () => {
    const fn = stub({ get: readOnce(), patch: body => json({ status: 'saved', detail: detail({ hidden: (body as { hidden: boolean }).hidden }) }) })
    open(dev(), 'advanced')
    await loaded()
    fireEvent.click(hide())
    // Other parts of the page hold a status of their own, so the notice is found by its text.
    expect(await screen.findByText(UNCONFIRMED)).toHaveAttribute('role', 'status')
    expect(patches(fn)).toEqual([{ hidden: true }])
    expect(hide()).toHaveAttribute('aria-checked', 'true')
    expect(hide()).toBeEnabled()
    // The write did go through, so it is said.
    expect(toast.success).toHaveBeenCalledWith('Bot hidden')
  })

  it('shows the error and the old switch when the write fails, and never toasts success', async () => {
    stub({ get: readOnce(), patch: () => json({ error: 'hermes_error', message: 'ui_meta is locked' }, 502) })
    open(dev(), 'advanced')
    await loaded()
    fireEvent.click(hide())
    await waitFor(() => expect(screen.getByText('ui_meta is locked')).toHaveAttribute('role', 'alert'))
    await waitFor(() => expect(hide()).toBeEnabled())
    expect(hide()).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText(UNCONFIRMED)).toBeNull()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('treats an answer that is not "saved" as a failed write', async () => {
    stub({ patch: () => json({ status: 'confirm_required', message: 'costly' }) })
    open(dev(), 'advanced')
    await loaded()
    fireEvent.click(hide())
    await waitFor(() => expect(screen.getByText("Couldn't save. Try again.")).toHaveAttribute('role', 'alert'))
    expect(hide()).toHaveAttribute('aria-checked', 'false')
    expect(toast.success).not.toHaveBeenCalled()
  })
})
