import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { BotView, GroupView, Routing } from '@/state/types'

import { DeleteGroupDialog } from './DeleteGroupDialog'
import { GroupApiError, renameGroup, setGroupContext } from './groups-api'
import { MembersList } from './MembersList'
import { ReplyRule } from './ReplyRule'

const NAME_MAX = 64
const PURPOSE_MAX = 500
const NOTES_MAX = 4096
const LABEL = 'text-sm font-medium'

interface Form {
  name: string
  routing: Routing
  lead: string
  purpose: string
  notes: string
}

const fromView = (v: GroupView): Form => ({ name: v.name, routing: v.routing, lead: v.leadMemberId ?? '', purpose: v.purpose, notes: v.notes })
const sameContext = (a: Form, b: Form): boolean =>
  a.routing === b.routing && a.purpose === b.purpose && a.notes === b.notes && (a.routing !== 'lead' || a.lead === b.lead)

const errorText = (e: unknown): string => (e instanceof GroupApiError ? e.message : 'Something went wrong. Try again.')

/** Form state next to its baseline: a changed view is re-read only while nothing is edited. */
function useGroupForm(view: GroupView) {
  const [base, setBase] = useState(() => fromView(view))
  const [form, setForm] = useState(base)
  const nameDirty = form.name.trim() !== base.name
  const ctxDirty = !sameContext(form, base)
  useEffect(() => {
    const next = fromView(view)
    if (next.name === base.name && next.lead === base.lead && sameContext(next, base)) return
    if (!nameDirty && !ctxDirty) setForm(next)
    setBase(next)
  }, [view]) // eslint-disable-line react-hooks/exhaustive-deps
  return { form, base, setBase, nameDirty, ctxDirty, edit: (change: Partial<Form>) => setForm(f => ({ ...f, ...change })) }
}

function Counter({ value, max }: { value: string; max: number }) {
  return <span className="self-end text-xs text-muted-foreground">{`${value.length} / ${max}`}</span>
}

/** Right panel for a group: rename, fixed members, reply rule, purpose and notes, delete. */
export function GroupPanel({ view, bots, onDeleted, onClose }: { view: GroupView; bots: readonly BotView[]; onDeleted: () => void; onClose?: () => void }) {
  const { form, setBase, nameDirty, ctxDirty, edit } = useGroupForm(view)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  const rename = () => run(async () => {
    const name = form.name.trim()
    await renameGroup(view.id, name)
    setBase(b => ({ ...b, name }))
    edit({ name })
    toast.success('Group renamed')
  })
  const save = () => run(async () => {
    const body = { routing: form.routing, purpose: form.purpose, notes: form.notes }
    await setGroupContext(view.id, form.routing === 'lead' ? { ...body, leadMemberId: form.lead } : body)
    setBase(b => ({ ...b, routing: form.routing, lead: form.lead, purpose: form.purpose, notes: form.notes }))
    toast.success('Saved')
  })
  const leadMissing = form.routing === 'lead' && !form.lead

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold">Group details</h2>
        {onClose && <Button type="button" variant="ghost" size="icon-sm" aria-label="Close panel" onClick={onClose}><X /></Button>}
      </div>
      <div className="flex flex-col gap-5 p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="group-panel-name" className={LABEL}>Group name</label>
          <div className="flex gap-2">
            <Input id="group-panel-name" value={form.name} maxLength={NAME_MAX} onChange={e => edit({ name: e.target.value })} />
            <Button type="button" disabled={busy || !nameDirty || form.name.trim() === ''} onClick={() => void rename()}>Rename</Button>
          </div>
        </div>
        <MembersList group={view} bots={bots} />
        <ReplyRule group={view} bots={bots} routing={form.routing} lead={form.lead} onRouting={routing => edit({ routing })} onLead={lead => edit({ lead })} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor="group-purpose" className={LABEL}>What this group is for</label>
          <Textarea id="group-purpose" value={form.purpose} maxLength={PURPOSE_MAX} onChange={e => edit({ purpose: e.target.value })} />
          <Counter value={form.purpose} max={PURPOSE_MAX} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="group-notes" className={LABEL}>Notes for the bots</label>
          <Textarea id="group-notes" value={form.notes} maxLength={NOTES_MAX} onChange={e => edit({ notes: e.target.value })} />
          <Counter value={form.notes} max={NOTES_MAX} />
        </div>
        {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
        <Button type="button" disabled={busy || !ctxDirty || leadMissing} onClick={() => void save()}>Save</Button>
        <Button type="button" variant="destructive" onClick={() => setDeleting(true)}>Delete group</Button>
        <DeleteGroupDialog roomId={view.id} name={view.name} open={deleting} onOpenChange={setDeleting} onDeleted={onDeleted} />
      </div>
    </div>
  )
}
