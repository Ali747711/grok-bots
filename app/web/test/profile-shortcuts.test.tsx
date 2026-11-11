import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearProfileDrafts } from '@/features/profile/profile-drafts'

import { change, loaded, open, patches, stub } from './profile-harness'

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-type={String(props.type)} /> }
})

const cmdEnter = (target: Element, init: KeyboardEventInit = { metaKey: true }) => fireEvent.keyDown(target, { key: 'Enter', ...init })
const BAR = { dirty: true, busy: false, error: null, conflict: null, onSave: () => undefined, onDiscard: () => undefined, onReload: () => undefined, onSaveAnyway: () => undefined }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
  clearProfileDrafts()
})

describe('profile ⌘↵', () => {
  it('does not save from inside the open model list', async () => {
    const fn = stub()
    open()
    await loaded()
    change('Name', 'Dev Two')
    fireEvent.click(screen.getByRole('combobox', { name: 'Model' }))
    const list = screen.getByRole('listbox')
    cmdEnter(list)
    cmdEnter(within(list).getAllByRole('option')[0]!, { ctrlKey: true })
    expect(patches(fn)).toHaveLength(0)
    // From the field it still saves.
    cmdEnter(screen.getByLabelText('Name'))
    expect(patches(fn)).toHaveLength(1)
  })
})

describe('SaveBar shortcut hint', () => {
  const hintOn = async (platform: string) => {
    vi.stubGlobal('navigator', { platform })
    vi.resetModules()
    const { SaveBar } = await import('@/features/profile/SaveBar')
    const view = render(<SaveBar {...BAR} />)
    // The hint is hidden from assistive tech, so the button is still named "Save".
    const text = screen.getByRole('button', { name: 'Save' }).textContent
    view.unmount()
    return text
  }

  it('shows ⌘↵ on Apple platforms and Ctrl ↵ elsewhere, like the rail', async () => {
    expect(await hintOn('MacIntel')).toBe('Save⌘↵')
    expect(await hintOn('Linux x86_64')).toBe('SaveCtrl ↵')
    expect(await hintOn('Win32')).toBe('SaveCtrl ↵')
  })
})
