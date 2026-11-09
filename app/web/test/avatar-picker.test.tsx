import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { AVATAR_SWATCHES, AVATAR_TYPES } from '@/features/avatars/avatar-model'
import { AvatarPicker } from '@/features/avatars/AvatarPicker'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return {
    ...actual,
    BotAvatar: (props: Record<string, unknown>) => (
      <div data-testid="stub" data-type={String(props.type)} data-size={String(props.size)} data-paused={String(props.paused)}
        data-interactive={String(props.interactive)} data-shading={String(props.shading)} data-color={props.color === undefined ? '' : String(props.color)} />
    )
  }
})

const setup = (value: { type: (typeof AVATAR_TYPES)[number]; color?: string; photo?: string | null } = { type: 'cat' }) => {
  const onChange = vi.fn()
  render(<AvatarPicker value={value} onChange={onChange} />)
  return onChange
}

describe('AvatarPicker', () => {
  it('offers all 18 types, Default plus 8 colours and photo controls', () => {
    setup()
    const types = within(screen.getByRole('group', { name: 'Type' })).getAllByRole('button')
    expect(types.map(b => b.getAttribute('aria-label'))).toEqual([...AVATAR_TYPES])
    expect(screen.getByRole('button', { name: 'cat' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'ghost' })).toHaveAttribute('aria-pressed', 'false')
    const grid = within(screen.getByRole('button', { name: 'ghost' })).getByTestId('stub')
    expect(grid).toHaveAttribute('data-size', '44')
    expect(grid).toHaveAttribute('data-paused', 'true')
    expect(grid).toHaveAttribute('data-interactive', 'false')
    expect(grid).toHaveAttribute('data-shading', 'fabric')
    const colours = within(screen.getByRole('group', { name: 'Colour' })).getAllByRole('button')
    expect(colours.map(b => b.getAttribute('aria-label') ?? b.textContent)).toEqual(['Default', 'Blue', 'Violet', 'Pink', 'Orange', 'Yellow', 'Green', 'Teal', 'Slate'])
    expect(AVATAR_SWATCHES.map(s => s.hex)).toEqual(['#4aa8ff', '#7c5cff', '#ff6fae', '#ff8a3d', '#ffcf3d', '#3ccf7a', '#2ec4c4', '#8a94a6'])
    expect(screen.getByLabelText('Upload photo')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Remove photo' })).toBeNull()
  })

  it('sends no colour for Default and the hex for a swatch', () => {
    const onChange = setup({ type: 'cat', color: '#7c5cff' })
    expect(screen.getByRole('button', { name: 'Violet' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Default' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'cat', photo: undefined })
    expect(onChange.mock.lastCall![0]).not.toHaveProperty('color', expect.anything())
    fireEvent.click(screen.getByRole('button', { name: 'Teal' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'cat', color: '#2ec4c4' })
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    expect(onChange).toHaveBeenLastCalledWith({ type: 'ghost', color: '#7c5cff' })
  })

  it('previews the fur avatar at 72 px, or the photo with its name for the e2e', () => {
    const { unmount } = render(<AvatarPicker value={{ type: 'cat' }} onChange={() => undefined} />)
    const preview = screen.getByTestId('avatar-preview')
    expect(within(preview).getByTestId('stub')).toHaveAttribute('data-size', '72')
    expect(preview.querySelector('[aria-hidden="true"]')).not.toBeNull()
    unmount()
    render(<AvatarPicker value={{ type: 'cat', photo: 'data:image/png;base64,AAAA' }} onChange={() => undefined} />)
    expect(screen.getByRole('img', { name: 'Photo preview' })).toHaveAttribute('src', 'data:image/png;base64,AAAA')
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeInTheDocument()
  })
})
