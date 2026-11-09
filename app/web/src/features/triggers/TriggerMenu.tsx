import { Ellipsis } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { GHOST } from '@/features/routines/row-styles'
import type { RoutineView } from '@/features/routines/types'

import { ConfirmAction } from './ConfirmAction'
import { OUTCOME } from './outcome-format'
import { SecretView } from './SecretView'
import { TriggerEventsDialog } from './TriggerEventsDialog'
import { deleteTrigger, newSecret, sendTestEvent, triggerErrorText, warnUnsaved } from './triggers-api'
import type { TriggerView } from './types'

interface TriggerMenuProps {
  trigger: TriggerView
  /** Null for a trigger whose routine was deleted: it can only be inspected or removed. */
  routine: RoutineView | null
  onChanged: () => void
}

type Action = 'events' | 'test' | 'secret' | 'delete'

const CONFIRM = {
  test: { title: () => 'Send a test event?', description: 'This runs the routine (one model call).', confirm: 'Send test event' },
  secret: { title: () => 'Make a new secret?', description: 'The old secret stops working at once. Give the sender the new one.', confirm: 'Make new secret' },
  delete: {
    title: (name: string) => `Delete “${name}”?`,
    description: 'Events sent to its URL will be refused. Runs already in Hermes stay until Hermes removes them.',
    confirm: 'Delete'
  }
} as const

/** The "⋯" menu of a trigger: Show events, Send test event, New secret, Delete. */
export function TriggerMenu({ trigger, routine, onChanged }: TriggerMenuProps) {
  const [action, setAction] = useState<Action | null>(null)
  const [busy, setBusy] = useState(false)
  // The new secret lives only while its dialog is open.
  const [secret, setSecret] = useState<string | null>(null)

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    try {
      await work()
    } catch (e) {
      toast.error(triggerErrorText(e))
    } finally {
      setBusy(false)
      setAction(null)
    }
  }

  const confirm = () => {
    if (action === 'test') {
      void run(async () => {
        const { event } = await sendTestEvent(trigger.id)
        toast.success(`Test event: ${event ? OUTCOME[event.outcome].text : 'no answer'}`)
        onChanged()
      })
    } else if (action === 'secret') {
      void run(async () => {
        const made = await newSecret(trigger.id)
        warnUnsaved(made)
        setSecret(made.secret)
      })
    } else if (action === 'delete') {
      void run(async () => {
        warnUnsaved(await deleteTrigger(trigger.id))
        toast.success('Trigger deleted')
        onChanged()
      })
    }
  }

  const confirming = action === 'test' || action === 'secret' || action === 'delete' ? CONFIRM[action] : null

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button type="button" size="icon-sm" variant="ghost" aria-label={`${trigger.name} actions`} className={GHOST} />}>
          <Ellipsis aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setAction('events')}>Show events</DropdownMenuItem>
          {routine && <DropdownMenuItem onClick={() => setAction('test')}>Send test event</DropdownMenuItem>}
          {routine && <DropdownMenuItem onClick={() => setAction('secret')}>New secret</DropdownMenuItem>}
          <DropdownMenuItem variant="destructive" onClick={() => setAction('delete')}>Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <TriggerEventsDialog open={action === 'events'} onOpenChange={o => !o && setAction(null)} bot={trigger.bot} trigger={trigger} routine={routine} />
      <ConfirmAction
        open={confirming !== null}
        title={confirming?.title(trigger.name) ?? ''}
        description={confirming?.description ?? ''}
        confirm={confirming?.confirm ?? ''}
        destructive={action === 'delete'}
        busy={busy}
        onConfirm={confirm}
        onOpenChange={o => !o && !busy && setAction(null)}
      />
      <Dialog open={secret !== null} onOpenChange={o => !o && setSecret(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          {secret !== null && <SecretView source={trigger.source} url={trigger.url} secret={secret} events={trigger.events} />}
        </DialogContent>
      </Dialog>
    </>
  )
}
