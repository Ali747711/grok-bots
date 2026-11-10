import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ComputerSection } from '@/features/profile/ComputerSection'
import { useProfileSettings } from '@/features/profile/use-profile-settings'

import { json, puts, reads, settingsState, stubSettings } from './profile-settings-stub'

const NEVER_NOTE = "Each running screen holds about 350 MB until it's stopped."

function Harness({ name = 'scout', title = 'Scout', isPrimary = false }: { name?: string; title?: string; isPrimary?: boolean }) {
  const settings = useProfileSettings(name)
  return <ComputerSection name={name} title={title} isPrimary={isPrimary} screen={settings.screen} readError={settings.errors.screen} reload={settings.reload} />
}
const chip = (name: string) => screen.getByRole('radio', { name })
const loaded = () => waitFor(() => expect(screen.getAllByRole('radio').some(r => (r as HTMLInputElement).checked)).toBe(true))

afterEach(() => vi.unstubAllGlobals())

describe('ComputerSection', () => {
  it('PUTs 15, 60 and 0 from the sleep chips and notes Never', async () => {
    // A value Crew never writes (Hermes's own 30) shows as 15 min: Crew writes 15 at the next start (R3).
    const state = settingsState({ screen: { useScreen: false, idleStopMinutes: 30 } })
    const fn = stubSettings(state)
    render(<Harness />)
    await loaded()
    expect(screen.getByRole('radiogroup', { name: 'Stop the screen after' })).toBeInTheDocument()
    expect(chip('15 min')).toBeChecked()
    expect(screen.queryByText(NEVER_NOTE)).toBeNull()

    fireEvent.click(chip('1 hour'))
    await waitFor(() => expect(puts(fn, 'screen/config')).toEqual([{ idleStopMinutes: 60 }]))
    await waitFor(() => expect(reads(fn, 'screen/config')).toBe(2))
    await waitFor(() => expect(chip('1 hour')).toBeChecked())
    fireEvent.click(chip('Never'))
    await waitFor(() => expect(puts(fn, 'screen/config')).toEqual([{ idleStopMinutes: 60 }, { idleStopMinutes: 0 }]))
    await waitFor(() => expect(chip('Never')).toBeChecked())
    expect(screen.getByText(NEVER_NOTE)).toBeInTheDocument()
    fireEvent.click(chip('15 min'))
    await waitFor(() => expect(puts(fn, 'screen/config')).toEqual([{ idleStopMinutes: 60 }, { idleStopMinutes: 0 }, { idleStopMinutes: 15 }]))
    await waitFor(() => expect(chip('15 min')).toBeChecked())
    expect(screen.queryByText(NEVER_NOTE)).toBeNull()
  })

  it('moves the use-screen switch here and hides it for the primary', async () => {
    const state = settingsState()
    const fn = stubSettings(state)
    const first = render(<Harness />)
    const toggle = await screen.findByRole('switch', { name: 'Let Scout use its screen' })
    await waitFor(() => expect(toggle).toBeEnabled()) // disabled until the setting has loaded
    expect(toggle).not.toBeChecked()
    expect(screen.getByText(/next time Scout opens its browser/)).toBeInTheDocument()
    fireEvent.click(toggle)
    await waitFor(() => expect(puts(fn, 'screen/config')).toEqual([{ useScreen: true }]))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Let Scout use its screen' })).toBeChecked())
    first.unmount()

    render(<Harness name="default" title="Hermes" isPrimary />)
    await loaded()
    expect(screen.queryByRole('switch')).toBeNull()
    for (const input of screen.getAllByRole('radio')) expect(input).toBeDisabled()
    expect(screen.getByText("New bots copy Hermes's settings, so change these in Hermes")).toBeInTheDocument()
  })

  it('shows each row its own error and keeps what was re-read', async () => {
    const state = settingsState()
    state.fail['screen/config'] = () => json({ error: 'hermes_error', message: 'config unwritable' }, 502)
    stubSettings(state)
    render(<Harness />)
    await loaded()
    fireEvent.click(chip('Never'))
    expect(await screen.findByRole('alert')).toHaveTextContent('config unwritable')
    await waitFor(() => expect(chip('15 min')).toBeChecked())
    // The switch row did not fail, so it shows no error of its own.
    expect(screen.getAllByRole('alert')).toHaveLength(1)

    state.fail['screen/config'] = () => json({ error: 'primary_not_supported' }, 400)
    fireEvent.click(screen.getByRole('switch', { name: 'Let Scout use its screen' }))
    await waitFor(() => expect(screen.getAllByRole('alert')).toHaveLength(2))
    expect(screen.getByText('Change this in Hermes for the primary bot')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Let Scout use its screen' })).not.toBeChecked()
  })

  it('says why when the setting cannot be read', async () => {
    const state = settingsState()
    state.failRead['screen/config'] = () => json({ error: 'hermes_error', message: 'config unreadable' }, 502)
    stubSettings(state)
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't read this setting: config unreadable")
    expect(screen.getByRole('switch', { name: 'Let Scout use its screen' })).toBeDisabled()
  })
})
