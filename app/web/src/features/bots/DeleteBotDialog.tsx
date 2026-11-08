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
      setError(e instanceof CrewApiError && e.status === 503 ? 'Hermes is offline' : 'Could not delete the bot. Try again.')
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
