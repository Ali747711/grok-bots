import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Input } from '@/components/ui/input'

import { CrewApiError, deleteBot } from './bots-api'

interface DeleteBotDialogProps {
  name: string
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}

function deleteFailure(e: unknown, title: string): string {
  if (!(e instanceof CrewApiError)) return 'Could not delete the bot. Try again.'
  if (e.status === 503) return 'Hermes is offline'
  if (e.status === 409 && e.body?.error === 'sandbox_cleanup_failed') {
    return `Crew couldn't remove ${title}'s sandbox files. Start Docker, or download the sandbox image again, then try again.`
  }
  return 'Could not delete the bot. Try again.'
}

function DeleteForm({ name, title, onOpenChange, onDeleted }: Omit<DeleteBotDialogProps, 'open'>) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await deleteBot(name)
      onOpenChange(false)
      onDeleted()
    } catch (e) {
      setError(deleteFailure(e, title))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle>{`Delete ${title}?`}</AlertDialogTitle>
        <AlertDialogDescription>{`This permanently removes @${name}'s chats, routines, memory and files.`}</AlertDialogDescription>
      </AlertDialogHeader>
      <label htmlFor="delete-confirm" className="text-sm font-medium">{`Type ${name} to confirm`}</label>
      <Input id="delete-confirm" value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <AlertDialogFooter>
        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" variant="destructive" disabled={busy || typed !== name} onClick={() => void remove()}>Delete</Button>
      </AlertDialogFooter>
    </>
  )
}

/** Permanent delete, enabled only once the handle is typed. */
export function DeleteBotDialog({ open, ...rest }: DeleteBotDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={rest.onOpenChange}>
      <AlertDialogContent>
        <DeleteForm {...rest} />
      </AlertDialogContent>
    </AlertDialog>
  )
}
