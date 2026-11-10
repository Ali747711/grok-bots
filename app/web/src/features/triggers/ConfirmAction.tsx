import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'

interface ConfirmActionProps {
  open: boolean
  title: string
  description: string
  confirm: string
  destructive?: boolean
  busy: boolean
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}

/** Ask before an action that costs a model call, replaces a secret or deletes. The confirm button is off while it works. */
export function ConfirmAction({ open, title, description, confirm, destructive = false, busy, onConfirm, onOpenChange }: ConfirmActionProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" variant={destructive ? 'destructive' : 'default'} disabled={busy} onClick={onConfirm}>{confirm}</Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
