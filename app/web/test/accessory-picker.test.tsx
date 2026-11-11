import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AvatarChoice, BotDetail } from '@/features/bots/types'
import { AccessoryPicker } from '@/features/profile/AccessoryPicker'
import { clearProfileDrafts } from '@/features/profile/profile-drafts'

import { detail, dev, goTab, json, loaded, open, patches, stub } from './profile-harness'

vi.mock('sonner', () => ({ toast: { success: vi.fn() } }))
vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return {
    ...actual,
    BotAvatar: (props: Record<string, unknown>) => (
      <div data-testid="stub" data-type={String(props.type)} data-size={String(props.size)}
        data-wear={JSON.stringify({ face: props.face, hat: props.hat, glasses: props.glasses, headphones: props.headphones, bowTie: props.bowTie })} />
    )
  }
})

const PINK_CAT: AvatarChoice = { type: 'cat', color: '#ff6fae' }
const PHOTO = { look: { shape: 'squircle', color: '#6366f1', imageKind: 'photo' } } as const
const FINISHED = { name: 'dev', complete: true, steps: {}, needsModel: false }
const HINT = 'Accessories show on shape avatars.'

const chip = (group: string, name: string) => within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name })
const extra = (name: string) => screen.getByRole('switch', { name })
const preview = () => within(screen.getByTestId('avatar-preview')).getByTestId('stub')
const worn = () => JSON.parse(preview().getAttribute('data-wear')!) as unknown

/** A bot whose avatar the PATCH really changes, so a re-read shows what was saved. */
function stored(start: Partial<BotDetail> = { avatar: PINK_CAT }) {
  let current = detail(start)
  return {
    get: () => json(current),
    patch: (body: unknown) => {
      current = { ...current, avatar: (body as { avatar: AvatarChoice }).avatar }
      return json({ status: 'saved', detail: current })
    }
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  clearProfileDrafts()
})

describe('AccessoryPicker', () => {
  it('shows the library defaults for an avatar that wears nothing and reports each pick with the rest', () => {
    const onChange = vi.fn()
    render(<AccessoryPicker value={PINK_CAT} onChange={onChange} />)
    expect(within(screen.getByRole('radiogroup', { name: 'Face' })).getAllByRole('radio').map(r => r.parentElement?.textContent)).toEqual(['Eyes', 'Mouth'])
    expect(within(screen.getByRole('radiogroup', { name: 'Hat' })).getAllByRole('radio').map(r => r.parentElement?.textContent)).toEqual(['None', 'Beret', 'Beanie', 'Party', 'Crown'])
    expect(within(screen.getByRole('radiogroup', { name: 'Glasses' })).getAllByRole('radio').map(r => r.parentElement?.textContent)).toEqual(['None', 'Round', 'Square', 'Shades'])
    expect(chip('Face', 'Eyes')).toBeChecked()
    expect(chip('Hat', 'None')).toBeChecked()
    expect(chip('Glasses', 'None')).toBeChecked()
    expect(extra('Headphones')).toHaveAttribute('aria-checked', 'false')
    expect(extra('Bow tie')).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(chip('Face', 'Mouth'))
    fireEvent.click(chip('Glasses', 'Shades'))
    fireEvent.click(extra('Headphones'))
    fireEvent.click(extra('Bow tie'))
    expect(onChange.mock.calls.map(([next]) => next as unknown)).toEqual([
      { ...PINK_CAT, face: 'mouth' }, { ...PINK_CAT, glasses: 'shades' }, { ...PINK_CAT, headphones: true }, { ...PINK_CAT, bowTie: true }
    ])
  })

  it('shows what the avatar wears and takes an accessory off', () => {
    const onChange = vi.fn()
    const value: AvatarChoice = { type: 'cat', hat: 'beret', glasses: 'round', headphones: true }
    render(<AccessoryPicker value={value} onChange={onChange} />)
    expect(chip('Hat', 'Beret')).toBeChecked()
    expect(chip('Glasses', 'Round')).toBeChecked()
    expect(extra('Headphones')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(chip('Hat', 'None'))
    fireEvent.click(extra('Headphones'))
    expect(onChange.mock.calls.map(([next]) => next as unknown)).toEqual([{ ...value, hat: 'none' }, { ...value, headphones: false }])
  })

  it('holds every control and says why when disabled with a reason', () => {
    const onChange = vi.fn()
    render(<AccessoryPicker value={PINK_CAT} onChange={onChange} disabled reason={HINT} />)
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
    expect(screen.getByText(HINT)).toBeInTheDocument()
    fireEvent.click(extra('Bow tie'))
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('profile Avatar tab accessories', () => {
  it('saves a hat on click with the rest of the avatar', async () => {
    const fn = stub(stored())
    open(dev(), 'avatar')
    await loaded()
    expect(preview()).toHaveAttribute('data-size', '120')
    fireEvent.click(chip('Hat', 'Crown'))
    await waitFor(() => expect(patches(fn)).toEqual([{ avatar: { type: 'cat', color: '#ff6fae', hat: 'crown' } }]))
    // The preview wears it, and the picker is free again once the bot has been re-read.
    await waitFor(() => expect(chip('Hat', 'Crown')).toBeEnabled())
    expect(chip('Hat', 'Crown')).toBeChecked()
    expect(worn()).toEqual({ hat: 'crown' })

    // The next pick is built on what is stored now, and a type pick keeps what the avatar wears.
    fireEvent.click(extra('Bow tie'))
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ avatar: { type: 'cat', color: '#ff6fae', hat: 'crown', bowTie: true } })
    await waitFor(() => expect(screen.getByRole('button', { name: 'ghost' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    await waitFor(() => expect(patches(fn)).toHaveLength(3))
    expect(patches(fn)[2]).toEqual({ avatar: { type: 'ghost', color: '#ff6fae', hat: 'crown', bowTie: true } })
  })

  it('holds accessories while setup is unfinished and sends them with Finish setup', async () => {
    const fn = stub({ other: { 'POST /crew/bots/dev/finish': () => json(FINISHED) } })
    open(dev({ setupIncomplete: true }), 'avatar')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    fireEvent.click(chip('Glasses', 'Round'))
    fireEvent.click(extra('Headphones'))
    expect(patches(fn)).toHaveLength(0)
    expect(chip('Glasses', 'Round')).toBeChecked()
    expect(worn()).toEqual({ glasses: 'round', headphones: true })
    // The held picks outlive a tab switch.
    goTab('Soul')
    goTab('Avatar')
    expect(extra('Headphones')).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    await waitFor(() => expect(fn.mock.calls.filter(([u]) => u === '/crew/bots/dev/finish')).toHaveLength(1))
    const sent = JSON.parse(String(fn.mock.calls.find(([u]) => u === '/crew/bots/dev/finish')?.[1]?.body)) as unknown
    expect(sent).toEqual({ title: 'Dev', avatar: { type: 'ghost', glasses: 'round', headphones: true } })
    expect(patches(fn)).toHaveLength(0)
  })

  it('is disabled for a photo avatar', async () => {
    const fn = stub({ get: () => json(detail({ ...PHOTO, avatar: { type: 'cat', hat: 'crown' } })) })
    open(dev(), 'avatar')
    await loaded()
    expect(screen.getByText(HINT)).toBeInTheDocument()
    for (const radio of screen.getAllByRole('radio')) expect(radio).toBeDisabled()
    for (const toggle of screen.getAllByRole('switch')) expect(toggle).toBeDisabled()
    fireEvent.click(extra('Headphones'))
    fireEvent.click(chip('Hat', 'Beanie'))
    expect(patches(fn)).toHaveLength(0)
    // The photo and the type buttons still work as before.
    expect(screen.getByRole('img', { name: 'Photo preview' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove photo' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'ghost' })).toBeEnabled()
  })

  it('shows no hint and free controls for a shape avatar', async () => {
    stub(stored())
    open(dev(), 'avatar')
    await loaded()
    expect(screen.queryByText(HINT)).toBeNull()
    expect(chip('Hat', 'Crown')).toBeEnabled()
    expect(extra('Bow tie')).toBeEnabled()
  })

  it("shows Hermes's words when an accessory is refused, and puts back what is stored", async () => {
    const fn = stub({ get: () => json(detail({ avatar: PINK_CAT })), patch: () => json({ error: 'hermes_error', message: 'ui_meta is locked' }, 502) })
    open(dev(), 'avatar')
    await loaded()
    const before = fn.mock.calls.filter(([u, i]) => u === '/crew/bots/dev' && (i?.method ?? 'GET') === 'GET').length
    fireEvent.click(chip('Hat', 'Crown'))
    expect(await screen.findByRole('alert')).toHaveTextContent('ui_meta is locked')
    await waitFor(() => expect(chip('Hat', 'None')).toBeEnabled())
    expect(chip('Hat', 'None')).toBeChecked()
    expect(worn()).toEqual({})
    // The bot was read again after the refusal.
    expect(fn.mock.calls.filter(([u, i]) => u === '/crew/bots/dev' && (i?.method ?? 'GET') === 'GET').length).toBeGreaterThan(before)
  })

  it('puts back what is stored when an accessory is refused and the bot cannot be read again', async () => {
    let reads = 0
    stub({
      get: () => (reads++ === 0 ? json(detail({ avatar: PINK_CAT })) : json({ error: 'hermes_offline' }, 503)),
      patch: () => json({ error: 'hermes_offline' }, 503)
    })
    open(dev(), 'avatar')
    await loaded()
    fireEvent.click(chip('Hat', 'Crown'))
    expect(await screen.findByRole('alert')).toHaveTextContent('Hermes is offline')
    await waitFor(() => expect(chip('Hat', 'None')).toBeEnabled())
    expect(chip('Hat', 'None')).toBeChecked()
    expect(worn()).toEqual({})
  })

  it('holds the whole picker while an accessory is being saved', async () => {
    let release: (v: Response) => void = () => undefined
    const fn = stub({ get: () => json(detail({ avatar: PINK_CAT })), patch: () => new Promise<Response>(resolve => { release = resolve }) })
    open(dev(), 'avatar')
    await loaded()
    fireEvent.click(extra('Headphones'))
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(screen.getByRole('button', { name: 'ghost' })).toBeDisabled()
    expect(chip('Hat', 'Crown')).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'ghost' }))
    expect(patches(fn)).toHaveLength(1)
    release(new Response(JSON.stringify({ status: 'saved', detail: detail({ avatar: { ...PINK_CAT, headphones: true } }) })))
    await waitFor(() => expect(screen.getByRole('button', { name: 'ghost' })).toBeEnabled())
  })
})
