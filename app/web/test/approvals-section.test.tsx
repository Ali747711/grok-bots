import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApprovalsSection } from '@/features/profile/ApprovalsSection'
import { UNCONFIRMED } from '@/features/profile/use-profile-row-action'
import { useProfileSettings } from '@/features/profile/use-profile-settings'

import { json, puts, reads, settingsState, stubSettings } from './profile-settings-stub'

const MANUAL = 'Ask before risky commands'
const SMART = 'Let a checker model decide first'
const OFF = 'Never ask'
const Q5 = "Inside the sandbox, Scout runs commands and code without asking you. Hermes treats the sandbox as the safety boundary. Commands you've blocked in Hermes are still refused."

function Harness({ name = 'scout', title = 'Scout', isPrimary = false }: { name?: string; title?: string; isPrimary?: boolean }) {
  const settings = useProfileSettings(name)
  return <ApprovalsSection name={name} title={title} isPrimary={isPrimary} approvals={settings.approvals} readError={settings.errors.approvals} reload={settings.reload} onWritten={approvals => settings.apply({ approvals })} />
}
const radio = (name: string) => screen.getByRole('radio', { name: new RegExp(`^${name}`) })
const loaded = () => waitFor(() => expect(screen.getAllByRole('radio').some(r => (r as HTMLInputElement).checked)).toBe(true))

afterEach(() => vi.unstubAllGlobals())

describe('ApprovalsSection', () => {
  it('selects the effective mode and says Hermes default when unset', async () => {
    const state = settingsState()
    stubSettings(state)
    const first = render(<Harness />)
    await loaded()
    expect(radio(SMART)).toBeChecked()
    expect(radio(MANUAL)).not.toBeChecked()
    expect(screen.getByText(/Hermes's default/)).toBeInTheDocument()
    expect(screen.getByText('Hermes stops and asks you before each command it flags as risky.')).toBeInTheDocument()
    expect(screen.getByText('A model may approve risky commands without asking you; when it refuses, you still decide (Allow once / Deny). Each check costs a model call.')).toBeInTheDocument()
    expect(screen.getByText('Risky commands run without asking you.')).toBeInTheDocument()
    expect(screen.getByText('Applies from the next risky command.')).toBeInTheDocument()
    expect(screen.getByText('App actions ask through their own prompt. Never ask turns that off too.')).toBeInTheDocument()
    first.unmount()

    state.approvals = { mode: 'manual', isDefault: false, sandboxed: false }
    render(<Harness />)
    await loaded()
    expect(radio(MANUAL)).toBeChecked()
    expect(screen.queryByText(/Hermes's default/)).toBeNull()
  })

  it('PUTs manual and smart at once and shows an error per row', async () => {
    const state = settingsState()
    const fn = stubSettings(state)
    render(<Harness />)
    await loaded()
    fireEvent.click(radio(MANUAL))
    await waitFor(() => expect(puts(fn, 'approvals')).toEqual([{ mode: 'manual' }]))
    // The row shows what was re-read after the write.
    await waitFor(() => expect(reads(fn, 'approvals')).toBe(2))
    await waitFor(() => expect(radio(MANUAL)).toBeChecked())
    fireEvent.click(radio(SMART))
    await waitFor(() => expect(puts(fn, 'approvals')).toEqual([{ mode: 'manual' }, { mode: 'smart' }]))
    await waitFor(() => expect(radio(SMART)).toBeChecked())

    state.fail.approvals = () => json({ error: 'hermes_error', message: 'config is read-only' }, 502)
    fireEvent.click(radio(MANUAL))
    expect(await screen.findByRole('alert')).toHaveTextContent('config is read-only')
    // The refused choice is not shown as chosen: the list follows the re-read.
    await waitFor(() => expect(radio(SMART)).toBeChecked())
    expect(radio(MANUAL)).toBeEnabled()
  })

  it('holds the list while a write is on its way', async () => {
    const state = settingsState()
    let release: (r: Response) => void = () => undefined
    state.fail.approvals = () => new Promise<Response>(resolve => { release = resolve })
    stubSettings(state)
    render(<Harness />)
    await loaded()
    fireEvent.click(radio(MANUAL))
    await waitFor(() => expect(radio(SMART)).toBeDisabled())
    release(new Response(JSON.stringify({ error: 'hermes_offline' }), { status: 503 }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Hermes is offline')
    await waitFor(() => expect(radio(SMART)).toBeEnabled())
  })

  it('asks before Never ask, says apps drop to Read only, and PUTs off only after Turn off approvals', async () => {
    const state = settingsState()
    const fn = stubSettings(state)
    render(<Harness />)
    await loaded()
    fireEvent.click(radio(OFF))
    const confirm = await screen.findByRole('group', { name: 'Turn off approvals?' })
    expect(confirm).toHaveTextContent("Risky commands will run without asking you, and Scout's apps drop to Read only.")
    expect(puts(fn, 'approvals')).toEqual([])
    expect(radio(SMART)).toBeChecked()
    fireEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('group', { name: 'Turn off approvals?' })).toBeNull()
    expect(puts(fn, 'approvals')).toEqual([])

    fireEvent.click(radio(OFF))
    fireEvent.click(within(await screen.findByRole('group', { name: 'Turn off approvals?' })).getByRole('button', { name: 'Turn off approvals' }))
    await waitFor(() => expect(puts(fn, 'approvals')).toEqual([{ mode: 'off' }]))
    await waitFor(() => expect(radio(OFF)).toBeChecked())
    expect(screen.queryByRole('group', { name: 'Turn off approvals?' })).toBeNull()
  })

  it('shows the sandbox note only for a sandboxed bot, with Q5 wording', async () => {
    const state = settingsState()
    stubSettings(state)
    const first = render(<Harness />)
    await loaded()
    expect(screen.queryByText(/Inside the sandbox/)).toBeNull()
    first.unmount()

    state.approvals = { mode: 'manual', isDefault: false, sandboxed: true }
    render(<Harness />)
    await loaded()
    expect(screen.getByText(Q5)).toBeInTheDocument()
  })

  it('is read-only on the primary with the reason', async () => {
    const state = settingsState({ approvals: { mode: 'manual', isDefault: false, sandboxed: false } })
    const fn = stubSettings(state)
    render(<Harness name="default" title="Hermes" isPrimary />)
    await loaded()
    expect(radio(MANUAL)).toBeChecked()
    for (const input of screen.getAllByRole('radio')) expect(input).toBeDisabled()
    expect(screen.getByText("New bots copy Hermes's settings, so change these in Hermes")).toBeInTheDocument()
    fireEvent.click(radio(OFF))
    expect(screen.queryByRole('group', { name: 'Turn off approvals?' })).toBeNull()
    expect(puts(fn, 'approvals')).toEqual([])
  })

  it('says why when the setting cannot be read', async () => {
    const state = settingsState()
    state.failRead.approvals = () => json({ error: 'hermes_offline' }, 503)
    stubSettings(state)
    render(<Harness />)
    expect(await screen.findByRole('alert')).toHaveTextContent("Couldn't read this setting: Hermes is offline")
    for (const input of screen.getAllByRole('radio')) expect(input).toBeDisabled()
  })

  it('keeps the written mode and says it could not be re-checked when the re-read fails', async () => {
    const state = settingsState()
    const fn = stubSettings(state)
    render(<Harness />)
    await loaded()
    state.failRead.approvals = () => json({ error: 'hermes_offline' }, 503)
    fireEvent.click(radio(MANUAL))
    expect(await screen.findByRole('status')).toHaveTextContent(UNCONFIRMED)
    expect(radio(MANUAL)).toBeChecked()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText(/Hermes's default/)).toBeNull()

    // The same for Never ask: Hermes holds `off`, so the list must say so.
    fireEvent.click(radio(OFF))
    fireEvent.click(within(await screen.findByRole('group', { name: 'Turn off approvals?' })).getByRole('button', { name: 'Turn off approvals' }))
    await waitFor(() => expect(radio(OFF)).toBeChecked())
    await waitFor(() => expect(radio(OFF)).toBeEnabled())
    expect(puts(fn, 'approvals')).toEqual([{ mode: 'manual' }, { mode: 'off' }])
    expect(screen.getByRole('status')).toHaveTextContent(UNCONFIRMED)

    // A write that is confirmed takes the notice away.
    delete state.failRead.approvals
    fireEvent.click(radio(SMART))
    await waitFor(() => expect(radio(SMART)).toBeChecked())
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull())
  })

  it('shows the mode just sent when the write answers without one and the re-read fails', async () => {
    const state = settingsState()
    stubSettings(state)
    render(<Harness />)
    await loaded()
    state.fail.approvals = () => json({})
    state.failRead.approvals = () => json({ error: 'hermes_offline' }, 503)
    fireEvent.click(radio(MANUAL))
    expect(await screen.findByRole('status')).toHaveTextContent(UNCONFIRMED)
    expect(radio(MANUAL)).toBeChecked()
  })

  it('shows the error and the old mode when the write fails, even if the re-read fails too', async () => {
    const state = settingsState()
    stubSettings(state)
    render(<Harness />)
    await loaded()
    state.fail.approvals = () => json({ error: 'hermes_error', message: 'config is read-only' }, 502)
    state.failRead.approvals = () => json({ error: 'hermes_offline' }, 503)
    fireEvent.click(radio(MANUAL))
    expect(await screen.findByRole('alert')).toHaveTextContent('config is read-only')
    await waitFor(() => expect(radio(SMART)).toBeEnabled())
    expect(radio(SMART)).toBeChecked()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('never writes off from the arrow keys: arrowing onto Never ask only opens the confirm', async () => {
    const state = settingsState()
    const fn = stubSettings(state)
    render(<Harness />)
    await loaded()
    // What a browser does for ArrowDown on the chosen radio: it moves to the next one and clicks it
    // (jsdom has no arrow-key navigation, so the click is sent by hand).
    radio(SMART).focus()
    fireEvent.keyDown(radio(SMART), { key: 'ArrowDown' })
    fireEvent.click(radio(OFF))
    expect(await screen.findByRole('group', { name: 'Turn off approvals?' })).toBeInTheDocument()
    expect(puts(fn, 'approvals')).toEqual([])
    expect(radio(SMART)).toBeChecked()
    // Space and Enter on the unconfirmed row write nothing either.
    fireEvent.keyDown(radio(OFF), { key: ' ' })
    fireEvent.keyDown(radio(OFF), { key: 'Enter' })
    expect(puts(fn, 'approvals')).toEqual([])
    expect(state.approvals.mode).toBe('smart')
  })
})
