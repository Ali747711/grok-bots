import { useState } from 'react'

import { DIALOG_DESCRIPTION, DIALOG_TITLE, FIELD, FIELD_LABEL, HINT } from '@/components/console/dialog-styles'
import { RadioRows } from '@/components/console/radio-rows'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { RoutineView } from '@/features/routines/types'

import { SecretView } from './SecretView'
import { GITHUB_EVENTS } from './setup-help'
import { createTrigger, triggerErrorText, warnUnsaved } from './triggers-api'
import type { CreatedTrigger, TriggerSource } from './types'

interface AddTriggerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  bot: string
  routine: RoutineView
  onCreated: () => void
  sandboxed: boolean
}

const LABEL = FIELD_LABEL
/** A warning or a failure as a well on the shell: its text carries the colour, never a tint (PF31). */
const NOTICE = 'rounded-2xl border-0 bg-background px-3.5 py-3'
const NOTICE_TEXT = 'text-xs font-medium'
const SOURCES: readonly { value: TriggerSource; label: string }[] = [{ value: 'github', label: 'GitHub' }, { value: 'generic', label: 'Generic' }]
const WARNING = "Runs started by events use this routine's tools. Outside text could try to steer the bot; it is marked as data, and risky actions are refused because nobody is there to approve them."

/** A comma list as a de-duplicated array of non-empty words. */
const words = (text: string): string[] => [...new Set(text.split(',').map(w => w.trim()).filter(Boolean))]

interface FormState {
  name: string
  source: TriggerSource
  checked: string[]
  other: string
  actions: string
  generic: string
}

function SourceFields({ form, set }: { form: FormState; set: (patch: Partial<FormState>) => void }) {
  if (form.source === 'generic') {
    return (
      <div className={FIELD}>
        <label htmlFor="trigger-generic" className={LABEL}>Event types</label>
        <Input id="trigger-generic" value={form.generic} placeholder="deploy, alert" onChange={e => set({ generic: e.target.value })} />
      </div>
    )
  }
  const toggle = (event: string, on: boolean) => set({ checked: on ? [...form.checked, event] : form.checked.filter(e => e !== event) })
  return (
    <>
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-1 border-0 p-0">
        <legend className={`${LABEL} mb-2`}>Events</legend>
        {GITHUB_EVENTS.map(event => (
          <label key={event} className="flex h-8 cursor-pointer items-center gap-2 rounded-full bg-background pr-3 pl-2.5 text-[13px] font-medium transition-colors has-focus-visible:ring-3 has-focus-visible:ring-ring">
            <Checkbox checked={form.checked.includes(event)} onCheckedChange={v => toggle(event, v)} aria-label={event} className="border-ring bg-shell focus-visible:ring-0" />
            <span>{event}</span>
          </label>
        ))}
      </fieldset>
      <div className={FIELD}>
        <label htmlFor="trigger-other" className={LABEL}>Other event types</label>
        <Input id="trigger-other" value={form.other} placeholder="deployment, check_run" onChange={e => set({ other: e.target.value })} />
      </div>
      <div className={FIELD}>
        <label htmlFor="trigger-actions" className={LABEL}>Actions</label>
        <Input id="trigger-actions" value={form.actions} placeholder="opened, closed" onChange={e => set({ actions: e.target.value })} />
      </div>
    </>
  )
}

function eventsOf(form: FormState): string[] {
  if (form.source === 'generic') return words(form.generic)
  return [...new Set([...GITHUB_EVENTS.filter(e => form.checked.includes(e)), ...words(form.other)])]
}

/** The form and, after Create, the one-time secret view. It lives only while the dialog is open. */
function AddTriggerBody({ bot, routine, onCreated, sandboxed }: Omit<AddTriggerDialogProps, 'open' | 'onOpenChange'>) {
  const [form, setForm] = useState<FormState>({ name: '', source: 'github', checked: [], other: '', actions: '', generic: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [made, setMade] = useState<{ result: CreatedTrigger; events: string[] } | null>(null)
  const set = (patch: Partial<FormState>) => setForm(f => ({ ...f, ...patch }))

  const create = async () => {
    const events = eventsOf(form)
    setBusy(true)
    setError(null)
    try {
      const result = await createTrigger(bot, {
        routineId: routine.id, name: form.name.trim(), source: form.source, events, actions: form.source === 'github' ? words(form.actions) : []
      })
      warnUnsaved(result)
      setMade({ result, events })
      onCreated()
    } catch (e) {
      setError(triggerErrorText(e))
    } finally {
      setBusy(false)
    }
  }

  if (made) return <SecretView source={form.source} url={made.result.url} secret={made.result.secret} events={made.events} />
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle className={DIALOG_TITLE}>Add trigger</DialogTitle>
        <DialogDescription className={DIALOG_DESCRIPTION}>{`Start “${routine.title}” when an event arrives.`}</DialogDescription>
      </DialogHeader>
      <div className={FIELD}>
        <label htmlFor="trigger-name" className={LABEL}>Name</label>
        <Input id="trigger-name" value={form.name} maxLength={80} onChange={e => set({ name: e.target.value })} />
      </div>
      <RadioRows legend="Source" value={form.source} options={SOURCES} onChange={source => set({ source })} />
      <SourceFields form={form} set={set} />
      <div>
        <p className={HINT}>Leave empty to accept every event.</p>
        {!sandboxed && <p className={HINT}>Tip: turn on the sandbox for bots that act on outside events</p>}
      </div>
      <Alert className={NOTICE}><AlertDescription className={NOTICE_TEXT}>{WARNING}</AlertDescription></Alert>
      {error && <Alert variant="destructive" className={NOTICE}><AlertDescription className={NOTICE_TEXT}>{error}</AlertDescription></Alert>}
      <div className="flex justify-end">
        <Button type="button" disabled={busy || form.name.trim() === ''} onClick={() => void create()}>Create</Button>
      </div>
    </div>
  )
}

export function AddTriggerDialog({ open, onOpenChange, ...rest }: AddTriggerDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-5 overflow-y-auto sm:max-w-lg">
        {/* Mounted only while open, so the secret and the draft are dropped on close. */}
        {open && <AddTriggerBody {...rest} />}
      </DialogContent>
    </Dialog>
  )
}
