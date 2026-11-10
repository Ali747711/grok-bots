import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearProfileDrafts } from '@/features/profile/profile-drafts'

import { type Tab, change, detail, dev, gets, goTab, json, loaded, open, patches, pick, save, saveButton, stub, tree, where } from './profile-harness'
import { settingsState } from './profile-settings-stub'

const toast = vi.hoisted(() => ({ success: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('bot-avatars', async () => {
  const actual = await vi.importActual<typeof import('bot-avatars')>('bot-avatars')
  return { ...actual, BotAvatar: (props: Record<string, unknown>) => <div data-testid="stub" data-type={String(props.type)} /> }
})

const CAREFUL = 'You are Dev. Check your work before you report it, say plainly when you are unsure, and ask before any step that cannot be undone.'
const FAST = 'You are Dev. Move quickly, pick sensible defaults without asking, and keep updates to one line.'
const FRIENDLY = 'You are Dev. Be warm and plain-spoken, explain what you are doing as you go, and never hide a mistake.'
const cmdEnter = (target: Element, init: KeyboardEventInit = { metaKey: true }) => fireEvent.keyDown(target, { key: 'Enter', ...init })

afterEach(() => {
  vi.unstubAllGlobals()
  toast.success.mockClear()
  clearProfileDrafts()
})

describe('ProfilePage', () => {
  it('opens the tab named in ?tab and writes the tab to the URL', async () => {
    stub()
    const first = open(dev(), 'soul')
    await loaded()
    expect(screen.getByRole('tab', { name: 'Soul' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Be nice')
    expect(screen.queryByLabelText('Name')).toBeNull()
    expect(screen.getAllByRole('tab').map(t => t.textContent)).toEqual(['Identity', 'Avatar', 'Soul', 'Apps', 'Advanced'])

    goTab('Advanced')
    expect(where()).toBe('/bots/dev?panel=profile&tab=advanced')
    expect(await screen.findByRole('heading', { name: 'Approvals' })).toBeInTheDocument()
    goTab('Identity')
    expect(where()).toBe('/bots/dev?panel=profile')
    expect(screen.getByLabelText('Name')).toHaveValue('Dev')
    first.unmount()

    // No tab, an unknown tab, and Skills (not built yet) all show Identity.
    for (const tab of [undefined, 'nope', 'skills']) {
      const view = open(dev(), tab as Tab | undefined)
      await loaded()
      expect(screen.getByRole('tab', { name: 'Identity' })).toHaveAttribute('aria-selected', 'true')
      expect(screen.getByLabelText('Name')).toBeInTheDocument()
      view.unmount()
    }
  })

  it('shows the name, the read-only handle, the header and the field limits', async () => {
    stub()
    open(dev({ status: 'working' }))
    await loaded()
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Dev' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveTextContent('Working')
    expect(screen.getByLabelText('Name')).toHaveValue('Dev')
    expect(screen.getByLabelText('Name')).toHaveAttribute('maxlength', '80')
    expect(within(screen.getByRole('tabpanel')).getByText('@dev')).toBeInTheDocument()
    expect(screen.getByLabelText('Job')).toHaveAttribute('maxlength', '2000')
    goTab('Soul')
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveAttribute('maxlength', '100000')
  })

  it('shows the save bar only when a text field changed; Discard resets; Save sends one patch with baselines', async () => {
    const fn = stub({ patch: () => json({ status: 'saved', detail: detail({ title: 'Dev Two', description: 'New job', soul: 'Be brief' }) }) })
    open()
    await loaded()
    expect(saveButton()).toBeNull()
    expect(screen.queryByText('Unsaved changes')).toBeNull()

    change('Name', 'Dev Two')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Dev')
    expect(saveButton()).toBeNull()

    // One bar for every text field, across tabs.
    change('Name', 'Dev Two')
    change('Job', 'New job')
    goTab('Soul')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    change('Persona (SOUL.md)', 'Be brief')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({
      title: 'Dev Two', description: 'New job', soul: 'Be brief', baseline: { description: 'Does dev', soul: 'Be nice' }
    })
    await waitFor(() => expect(saveButton()).toBeNull())
    expect(toast.success).toHaveBeenCalledWith('Profile saved')
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Be brief')
  })

  it('sends the name as the title and the baseline for the model', async () => {
    const fn = stub()
    open()
    await loaded()
    change('Name', 'Dev Two')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled())
    pick('Model', 'b/two')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({
      title: 'Dev Two', model: { provider: 'openrouter', model: 'b/two' }, baseline: { model: { provider: 'openrouter', model: 'a/one' } }
    })
  })

  it('saves with ⌘Enter from inside a field', async () => {
    const fn = stub()
    open()
    await loaded()
    // Nothing to save: the keys do nothing.
    cmdEnter(screen.getByLabelText('Name'))
    expect(patches(fn)).toHaveLength(0)

    change('Job', 'New job')
    // Enter alone belongs to the field.
    fireEvent.keyDown(screen.getByLabelText('Job'), { key: 'Enter' })
    expect(patches(fn)).toHaveLength(0)
    cmdEnter(screen.getByLabelText('Job'))
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ description: 'New job', baseline: { description: 'Does dev' } })

    await waitFor(() => expect(saveButton()).toBeNull())
    goTab('Soul')
    change('Persona (SOUL.md)', 'Be brief')
    cmdEnter(screen.getByLabelText('Persona (SOUL.md)'), { ctrlKey: true })
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ soul: 'Be brief', baseline: { soul: 'Be nice' } })
  })

  it('does not save with ⌘Enter from the delete dialog', async () => {
    const fn = stub()
    open()
    await loaded()
    change('Name', 'Dev Two')
    goTab('Advanced')
    fireEvent.click(screen.getByRole('button', { name: 'Delete bot' }))
    cmdEnter(screen.getByLabelText('Type dev to confirm'))
    expect(patches(fn)).toHaveLength(0)
  })

  it('keeps role in the save bar and sends it unguarded', async () => {
    const fn = stub({ patch: () => json({ status: 'saved', detail: detail({ role: 'engineer' }) }) })
    open()
    await loaded()
    expect(screen.getByRole('radio', { name: 'None' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'Engineer' }))
    // A role is a choice, but it waits for Save with the text fields.
    expect(patches(fn)).toHaveLength(0)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ role: 'engineer' })
    await waitFor(() => expect(saveButton()).toBeNull())
    expect(screen.getByRole('radio', { name: 'Engineer' })).toBeChecked()

    // Clearing it sends null, still with no baseline.
    fireEvent.click(screen.getByRole('radio', { name: 'None' }))
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ role: null })
  })

  it('shows the conflict banner and Save anyway', async () => {
    const current = detail({ soul: 'Their soul' })
    let n = 0
    const fn = stub({ patch: () => (n++ === 0 ? json({ status: 'conflict', fields: ['soul'], current }, 409) : json({ status: 'saved', detail: detail({ soul: 'Mine' }) })) })
    open(dev(), 'soul')
    await loaded()
    change('Persona (SOUL.md)', 'Mine')
    save()
    expect(await screen.findByText(/Changed in another app: Persona/)).toBeInTheDocument()
    // Nothing was overwritten: the second write only goes out on Save anyway, against their version.
    expect(patches(fn)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Save anyway' }))
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ soul: 'Mine', baseline: { soul: 'Their soul' } })
    await waitFor(() => expect(screen.queryByText(/Changed in another app/)).toBeNull())
  })

  it('reloads their version from a conflict, and Discard does the same', async () => {
    stub({ patch: () => json({ status: 'conflict', fields: ['soul'], current: detail({ soul: 'Their soul' }) }, 409) })
    open(dev(), 'soul')
    await loaded()
    change('Persona (SOUL.md)', 'Mine')
    save()
    fireEvent.click(await screen.findByRole('button', { name: 'Reload' }))
    await waitFor(() => expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Their soul'))
    expect(screen.queryByText(/Changed in another app/)).toBeNull()

    change('Persona (SOUL.md)', 'Mine again')
    save()
    await screen.findByText(/Changed in another app: Persona/)
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Their soul')
    // A dismissed conflict leaves no Save anyway behind.
    expect(screen.queryByRole('button', { name: 'Save anyway' })).toBeNull()
    expect(saveButton()).toBeNull()
  })

  it('W4: the conflict banner uses the field labels', async () => {
    stub({ patch: () => json({ status: 'conflict', fields: ['description', 'soul', 'model'], current: detail() }, 409) })
    open()
    await loaded()
    change('Job', 'Mine')
    save()
    expect(await screen.findByText(/Changed in another app: Job, Persona, Model\./)).toBeInTheDocument()
  })

  it('asks before an expensive model', async () => {
    let n = 0
    const fn = stub({ patch: () => (n++ === 0 ? json({ status: 'confirm_required', message: 'This model is expensive' }, 409) : json({ status: 'saved', detail: detail() })) })
    open()
    await loaded()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toBeEnabled())
    pick('Model', 'b/two')
    save()
    expect(await screen.findByText('This model is expensive')).toBeInTheDocument()
    expect(patches(fn)).toHaveLength(1)
    expect(patches(fn)[0]).not.toHaveProperty('confirmExpensiveModel')
    fireEvent.click(screen.getByRole('button', { name: 'Use this model' }))
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toMatchObject({ confirmExpensiveModel: true, model: { provider: 'openrouter', model: 'b/two' } })
  })

  it('shows the error after a failed save, re-reads the bot and keeps the edits', async () => {
    const fn = stub({ patch: () => json({ error: 'not_saved', section: 'soul' }, 502) })
    open(dev(), 'soul')
    await loaded()
    change('Persona (SOUL.md)', 'Mine')
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not save/)
    await waitFor(() => expect(gets(fn)).toBe(2))
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Mine')
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
  })

  it('after a failed save keeps only what Hermes did not write as unsaved', async () => {
    let reads = 0
    let n = 0
    const fn = stub({
      get: () => json(reads++ === 0 ? detail() : detail({ description: 'New job' })),
      patch: () => (n++ === 0 ? json({ error: 'not_saved' }, 502) : json({ status: 'saved', detail: detail({ description: 'New job', soul: 'Mine' }) }))
    })
    open()
    await loaded()
    change('Job', 'New job')
    goTab('Soul')
    change('Persona (SOUL.md)', 'Mine')
    save()
    await screen.findByRole('alert')
    await waitFor(() => expect(reads).toBe(2))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled())
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(2))
    expect(patches(fn)[1]).toEqual({ soul: 'Mine', baseline: { soul: 'Be nice' } })
  })

  it('W5: a Crew validation error is never labelled as Hermes refusing', async () => {
    stub({ patch: () => json({ error: 'bad_body', message: 'Too big: expected string <=2000' }, 400) })
    open()
    await loaded()
    change('Job', 'x')
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent("Some fields aren't filled in correctly.")
    expect(screen.queryByText(/Hermes refused/)).toBeNull()
  })

  it("W5: Hermes's own refusal keeps its words", async () => {
    stub({ patch: () => json({ error: 'rejected', message: 'No such model' }, 400) })
    open()
    await loaded()
    change('Job', 'x')
    save()
    expect(await screen.findByRole('alert')).toHaveTextContent('Hermes refused it: No such model')
  })

  it('shows a pinned model that is not in the list, never the default sentinel', async () => {
    stub({ get: () => json(detail({ model: { provider: 'openrouter', model: 'z/pinned' } })) })
    open()
    await loaded()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('z/pinned'))
    expect(screen.getByRole('combobox', { name: 'Model' })).not.toHaveTextContent('__default__')
  })

  it('shows the pinned model id when the model list fails to load', async () => {
    stub({ models: () => json({}, 500), get: () => json(detail({ model: { provider: 'openrouter', model: 'a/one' } })) })
    open()
    await loaded()
    expect(await screen.findByText("Couldn't load models")).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Model' })).toHaveTextContent('a/one')
    expect(screen.getByRole('combobox', { name: 'Model' })).not.toHaveTextContent('__default__')
  })

  it('keeps unsaved edits per bot across leaving the profile', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const researcher = dev({ name: 'researcher', title: 'Researcher' })
    const fn = stub({ get: name => json(name === 'researcher' ? detail({ name: 'researcher', title: 'Researcher', description: 'Reads papers', soul: 'Be exact' }) : detail()) })
    const view = open()
    await loaded()
    change('Name', 'Dev Two')
    goTab('Soul')
    change('Persona (SOUL.md)', 'Half a persona')

    // The rail picks another bot: its profile shows its own values and nothing unsaved.
    view.rerender(tree(researcher))
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Researcher'))
    expect(screen.getByLabelText('Job')).toHaveValue('Reads papers')
    expect(saveButton()).toBeNull()
    goTab('Soul')
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Be exact')

    // Leaving the profile altogether (Esc, Back) unmounts it.
    view.unmount()
    expect(setItem).not.toHaveBeenCalled()
    setItem.mockRestore()

    // Back on the first bot, the edits are still there and still unsaved, with their first baselines.
    open()
    await waitFor(() => expect(screen.getByLabelText('Name')).toHaveValue('Dev Two'))
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()
    goTab('Soul')
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Half a persona')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    expect(patches(fn)[0]).toEqual({ title: 'Dev Two', soul: 'Half a persona', baseline: { soul: 'Be nice' } })
    expect(fn.mock.calls.filter(([, i]) => i?.method === 'PATCH').map(([u]) => u)).toEqual(['/crew/bots/dev'])
  })

  it('drops the kept edits once they are saved or discarded', async () => {
    stub({ patch: () => json({ status: 'saved', detail: detail({ title: 'Dev Two' }) }), get: () => json(detail()) })
    const first = open()
    await loaded()
    change('Name', 'Dev Two')
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }))
    first.unmount()
    open()
    await loaded()
    expect(screen.getByLabelText('Name')).toHaveValue('Dev')
    expect(saveButton()).toBeNull()
  })

  it('keeps a kept edit as a conflict when the field changed elsewhere meanwhile', async () => {
    let soul = 'Be nice'
    const fn = stub({ get: () => json(detail({ soul })), patch: () => json({ status: 'conflict', fields: ['soul'], current: detail({ soul: 'Their soul' }) }, 409) })
    const first = open(dev(), 'soul')
    await loaded()
    change('Persona (SOUL.md)', 'Mine')
    first.unmount()
    soul = 'Their soul'
    open(dev(), 'soul')
    await loaded()
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue('Mine')
    save()
    await waitFor(() => expect(patches(fn)).toHaveLength(1))
    // The baseline is what the user started from, so the server sees the change elsewhere.
    expect(patches(fn)[0]).toEqual({ soul: 'Mine', baseline: { soul: 'Be nice' } })
    expect(await screen.findByText(/Changed in another app: Persona/)).toBeInTheDocument()
  })

  it('Finish setup shows the problem and Try again when a step fails', async () => {
    let n = 0
    const partial = { name: 'dev', complete: false, steps: {}, needsModel: false, error: { step: 'look', message: 'ui_meta refused' } }
    const fn = stub({ other: { 'POST /crew/bots/dev/finish': () => json(n++ === 0 ? partial : { name: 'dev', complete: true, steps: {}, needsModel: false }) } })
    const first = open()
    await loaded()
    expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull()
    first.unmount()

    open(dev({ setupIncomplete: true }))
    await loaded()
    expect(screen.getByText('Setup was not finished.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("Finish setup didn't complete: ui_meta refused")
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(fn.mock.calls.filter(([u]) => u === '/crew/bots/dev/finish')).toHaveLength(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('shows a plain reason when finishing setup fails outright, and never for the primary', async () => {
    stub({ other: { 'POST /crew/bots/dev/finish': () => json({ error: 'hermes_error' }, 502) }, get: name => json(detail(name === 'default' ? { name: 'default', isPrimary: true, title: 'Hermes' } : {})) })
    const first = open(dev({ setupIncomplete: true }))
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Finish setup' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Could not/)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled()
    first.unmount()

    open(dev({ name: 'default', title: 'Hermes', isPrimary: true, setupIncomplete: true }))
    await loaded()
    expect(screen.queryByRole('button', { name: 'Finish setup' })).toBeNull()
  })

  it('Soul starters append after a blank line and never replace', async () => {
    const fn = stub({ get: () => json(detail({ soul: 'Be nice\n' })) })
    open(dev(), 'soul')
    await loaded()
    fireEvent.click(screen.getByRole('button', { name: 'Careful' }))
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue(`Be nice\n\n${CAREFUL}`)
    fireEvent.click(screen.getByRole('button', { name: 'Fast' }))
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue(`Be nice\n\n${CAREFUL}\n\n${FAST}`)
    // Nothing is written until Save.
    expect(patches(fn)).toHaveLength(0)
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    // An empty persona takes the text as it is.
    change('Persona (SOUL.md)', '  ')
    fireEvent.click(screen.getByRole('button', { name: 'Friendly' }))
    expect(screen.getByLabelText('Persona (SOUL.md)')).toHaveValue(FRIENDLY)
  })

  it('hides the summary card in a narrow container', async () => {
    stub({
      get: () => json(detail({ role: 'engineer', description: `${'Finds papers. '.repeat(12)}` })),
      settings: settingsState({ approvals: { mode: 'smart', isDefault: true, sandboxed: true }, screen: { useScreen: false, idleStopMinutes: 60 }, apps: 2 })
    })
    open(dev({ sandbox: 'on', model: 'openrouter/a/one' }))
    await loaded()
    const card = screen.getByRole('complementary', { name: 'Dev at a glance' })
    // jsdom has no layout: the class is the proof, the 1100×800 screenshot shows it (PF20).
    expect(card.className).toContain('@max-[820px]/profile:hidden')
    expect(card.closest('[class*="@container/profile"]')).not.toBeNull()

    expect(within(card).getByText('Dev')).toBeInTheDocument()
    expect(within(card).getByText('@dev')).toBeInTheDocument()
    expect(within(card).getByText('Engineer · one')).toBeInTheDocument()
    const excerpt = within(card).getByText(/^Finds papers\./)
    expect(excerpt.textContent).toHaveLength(120)
    expect(excerpt.textContent?.endsWith('…')).toBe(true)
    await waitFor(() => expect(within(card).getByText('2 apps connected')).toBeInTheDocument())
    expect(within(card).getByText('Checker decides first')).toBeInTheDocument()
    expect(within(card).getByText('1 hour')).toBeInTheDocument()
    expect(within(card).getByText('On')).toBeInTheDocument()
  })

  it('says so when the bot cannot be loaded', async () => {
    stub({ get: () => json({ error: 'hermes_offline' }, 503) })
    open()
    expect(await screen.findByText('Could not load this bot.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to chat' })).toBeInTheDocument()
  })
})

describe('ProfilePage settings', () => {
  it('re-reads the settings when the tab or the sandbox state changes, and survives an answer of the wrong shape', async () => {
    const settings = settingsState({ apps: 1 })
    const fn = stub({ settings })
    const view = open()
    await loaded()
    const card = () => screen.getByRole('complementary', { name: 'Dev at a glance' })
    await waitFor(() => expect(within(card()).getByText('1 app connected')).toBeInTheDocument())
    const before = fn.mock.calls.filter(([u]) => u === '/crew/bots/dev/apps').length
    expect(before).toBe(1)

    // The Apps tab changed the bot's apps on its own; leaving it shows the new count.
    settings.apps = 3
    goTab('Advanced')
    await waitFor(() => expect(within(card()).getByText('3 apps connected')).toBeInTheDocument())

    // The sandbox turned on (state stream): Approvals gains its sandbox note.
    settings.approvals = { ...settings.approvals, sandboxed: true }
    view.rerender(tree(dev({ sandbox: 'on' }), 'advanced'))
    expect(await screen.findByText(/^Inside the sandbox, Dev runs commands and code without asking you\./)).toBeInTheDocument()
    await waitFor(() => expect(within(card()).getByText('3 apps connected')).toBeInTheDocument())

    // A 200 with another shape is a failed read, never a crash; the last good values stay.
    settings.failRead.apps = () => json({ messages: [] })
    settings.failRead.approvals = () => json({ messages: [] })
    goTab('Identity')
    await waitFor(() => expect(fn.mock.calls.filter(([u]) => u === '/crew/bots/dev/apps').length).toBeGreaterThan(3))
    expect(within(card()).getByText('3 apps connected')).toBeInTheDocument()
    expect(within(card()).getByText('Checker decides first')).toBeInTheDocument()
  })
})
