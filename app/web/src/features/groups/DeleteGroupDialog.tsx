import { useState } from 'react'

import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

import { deleteGroup, GroupApiError } from './groups-api'

interface DeleteGroupDialogProps {
  roomId: string
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted: () => void
}

function failureText(error: unknown): string {
  if (error instanceof GroupApiError && error.code === 'still_stopping') return 'Still stopping. Try again in a moment.'
  if (error instanceof GroupApiError && error.code === 'hermes_offline') return 'Hermes is offline'
  return 'Could not delete the group. Try again.'
}

function DeleteForm({ roomId, name, onOpenChange, onDeleted }: Omit<DeleteGroupDialogProps, 'open'>) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await deleteGroup(roomId)
      onOpenChange(false)
      onDeleted()
    } catch (e) {
      setError(failureText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <AlertDialogHeader>
        <AlertDialogTitle className="text-[15px] font-semibold tracking-tight">{`Delete “${name}”?`}</AlertDialogTitle>
        <AlertDialogDescription className="text-[13px] font-medium">The group and its chat are removed from Crew and Hermes. The bots stay.</AlertDialogDescription>
      </AlertDialogHeader>
      {error && <p role="alert" className="text-[13px] font-medium text-destructive">{error}</p>}
      <AlertDialogFooter>
        <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="button" variant="destructive" disabled={busy} onClick={() => void remove()}>Delete group</Button>
      </AlertDialogFooter>
    </>
  )
}

/** Confirm, then stop the group's work and remove it. The server retries while Hermes is still stopping. */
export function DeleteGroupDialog({ open, ...rest }: DeleteGroupDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={rest.onOpenChange}>
      <AlertDialogContent>
        <DeleteForm {...rest} />
      </AlertDialogContent>
    </AlertDialog>
  )
}
