import { Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Section } from '@/components/console/fields'
import { IconButton } from '@/components/console/icon-button'
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
const LABEL = 'px-1 text-[13px] font-semibold'

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
  return <span className="self-end px-1 text-xs font-medium text-faint tabular-nums">{`${value.length} / ${max}`}</span>
}

interface DangerProps {
  view: GroupView
  onDeleted: () => void
}

/** Delete, behind the confirm dialog: the same row as a bot's danger zone. */
function GroupDanger({ view, onDeleted }: DangerProps) {
  const [deleting, setDeleting] = useState(false)
  return (
    <Section title="Danger zone">
      <div className="flex items-center gap-3 rounded-3xl border border-border p-1.5 pr-2">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-muted-foreground">
          <Trash2 className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{`Delete ${view.name}`}</p>
          <p className="truncate text-xs font-medium text-faint">Removes the group and its chat. The bots stay.</p>
        </div>
        <Button type="button" variant="destructive" onClick={() => setDeleting(true)}>Delete group</Button>
      </div>
      <DeleteGroupDialog roomId={view.id} name={view.name} open={deleting} onOpenChange={setDeleting} onDeleted={onDeleted} />
    </Section>
  )
}

interface GroupPanelProps {
  view: GroupView
  bots: readonly BotView[]
  /** Hermes or the Crew stream is down: statuses may be out of date. */
  stale: boolean
  onDeleted: () => void
  onClose?: () => void
}

/** Side panel for a group, in the side panel's shell: rename, fixed members, reply rule, purpose and notes, delete. */
export function GroupPanel({ view, bots, stale, onDeleted, onClose }: GroupPanelProps) {
  const { form, setBase, nameDirty, ctxDirty, edit } = useGroupForm(view)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-14 flex-none items-center justify-between gap-2 pr-3 pl-5">
        <h2 className="text-[15px] font-semibold tracking-tight">Group details</h2>
        {onClose && <IconButton label="Close panel" onClick={onClose}><X /></IconButton>}
      </header>
      <div className="flex min-h-0 flex-1 scroll-thin flex-col gap-6 overflow-y-auto px-4 pb-4">
        <div className="flex flex-col gap-2">
          <label htmlFor="group-panel-name" className={LABEL}>Group name</label>
          <div className="flex gap-2">
            <Input id="group-panel-name" value={form.name} maxLength={NAME_MAX} autoComplete="off" onChange={e => edit({ name: e.target.value })} />
            <Button type="button" variant="secondary" disabled={busy || !nameDirty || form.name.trim() === ''} onClick={() => void rename()}>Rename</Button>
          </div>
        </div>
        <MembersList group={view} bots={bots} stale={stale} />
        <ReplyRule group={view} bots={bots} routing={form.routing} lead={form.lead} onRouting={routing => edit({ routing })} onLead={lead => edit({ lead })} />
        <div className="flex flex-col gap-2">
          <label htmlFor="group-purpose" className={LABEL}>What this group is for</label>
          <Textarea id="group-purpose" value={form.purpose} maxLength={PURPOSE_MAX} onChange={e => edit({ purpose: e.target.value })} />
          <Counter value={form.purpose} max={PURPOSE_MAX} />
        </div>
        <div className="flex flex-col gap-2">
          <label htmlFor="group-notes" className={LABEL}>Notes for the bots</label>
          <Textarea id="group-notes" value={form.notes} maxLength={NOTES_MAX} onChange={e => edit({ notes: e.target.value })} />
          <Counter value={form.notes} max={NOTES_MAX} />
        </div>
        {error && <p role="alert" className="px-1 text-[13px] font-medium text-destructive">{error}</p>}
        <Button type="button" className="self-end" disabled={busy || !ctxDirty || leadMissing} onClick={() => void save()}>Save</Button>
        <GroupDanger view={view} onDeleted={onDeleted} />
      </div>
    </div>
  )
}
