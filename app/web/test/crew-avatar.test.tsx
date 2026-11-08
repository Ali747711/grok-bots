import { act, render, renderHook, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AVATAR_TYPES, avatarSeed, deriveAvatarType } from '@/features/avatars/avatar-model'
import { CrewAvatar } from '@/features/avatars/CrewAvatar'
import { useNow } from '@/features/avatars/use-now'

import { bot } from './fixtures'

vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return {
    ...actual,
    BotAvatar: (props: Record<string, unknown>) => (
      <div data-testid="stub" data-type={String(props.type)} data-state={String(props.state)} data-shading={String(props.shading)}
        data-seed={String(props.seed)} data-color={props.color === undefined ? '' : String(props.color)} data-size={String(props.size)}
        data-interactive={String(props.interactive)} />
    )
  }
})

afterEach(() => vi.useRealTimers())

describe('CrewAvatar', () => {
  it('passes fabric shading, a stable seed and the chosen colour', () => {
    render(<CrewAvatar bot={bot({ name: 'scout', avatar: { type: 'cat', color: '#112233' } })} size={34} />)
    const stub = screen.getByTestId('stub')
    expect(stub).toHaveAttribute('data-shading', 'fabric')
    expect(stub).toHaveAttribute('data-seed', String(avatarSeed('scout')))
    expect(stub).toHaveAttribute('data-color', '#112233')
    expect(stub).toHaveAttribute('data-type', 'cat')
    expect(stub).toHaveAttribute('data-size', '34')
    expect(stub).toHaveAttribute('data-interactive', 'true')
  })

  it('derives the type and leaves the colour to the library when none was chosen', () => {
    render(<CrewAvatar bot={bot({ name: 'scout', hasAvatar: true })} size={34} interactive={false} />)
    const stub = screen.getByTestId('stub')
    expect(stub).toHaveAttribute('data-type', deriveAvatarType('scout'))
    expect(stub).toHaveAttribute('data-color', '')
    expect(stub).toHaveAttribute('data-interactive', 'false')
  })

  it('shows the photo only for an uploaded photo', () => {
    render(<CrewAvatar bot={bot({ name: 'a b', imageKind: 'photo', hasAvatar: true })} size={34} />)
    expect(screen.queryByTestId('stub')).toBeNull()
    expect(document.querySelector('img')).toHaveAttribute('src', '/crew/avatars/a%20b')
  })

  it('maps working to the working state, asleep to a faded avatar', () => {
    const { rerender } = render(<CrewAvatar bot={bot({ name: 'x', status: 'working' })} size={34} />)
    expect(screen.getByTestId('stub')).toHaveAttribute('data-state', 'working')
    rerender(<CrewAvatar bot={bot({ name: 'x', hidden: true })} size={34} />)
    expect(screen.getByTestId('stub')).toHaveAttribute('data-state', 'sleeping')
    expect(screen.getByTestId('stub').parentElement).toHaveClass('opacity-60')
  })

  it('rings a working photo and fades a sleeping one', () => {
    const photo = { imageKind: 'photo' as const, hasAvatar: true }
    const { rerender } = render(<CrewAvatar bot={bot({ name: 'x', status: 'working', ...photo })} size={34} />)
    expect(document.querySelector('img')!.parentElement).toHaveClass('ring-2', 'ring-sky')
    rerender(<CrewAvatar bot={bot({ name: 'x', hidden: true, ...photo })} size={34} />)
    expect(document.querySelector('img')!.parentElement).toHaveClass('opacity-60')
  })

  it('shows the lime dot only when the bot needs you', () => {
    const { rerender } = render(<CrewAvatar bot={bot({ name: 'x', status: 'needs_you' })} size={34} />)
    expect(screen.getByLabelText('Needs you')).toHaveClass('bg-needs')
    rerender(<CrewAvatar bot={bot({ name: 'x', status: 'idle' })} size={34} />)
    expect(screen.queryByLabelText('Needs you')).toBeNull()
  })

  it('keeps a fixed-size box', () => {
    const { container } = render(<CrewAvatar bot={bot({ name: 'x' })} size={40} />)
    expect(container.firstElementChild).toHaveStyle({ width: '40px', height: '40px' })
  })

  it('matches the library palette', async () => {
    const real = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
    expect([...AVATAR_TYPES]).toEqual(real.botAvatarTypes)
  })
})

describe('useNow', () => {
  it('ticks on the interval', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const { result } = renderHook(() => useNow(60_000))
    expect(result.current).toBe(1000)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(result.current).toBe(61_000)
  })
})
