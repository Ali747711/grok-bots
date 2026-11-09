import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

import type { Confirm, Conflict } from './use-profile-save'

interface ConflictBannerProps {
  conflict: Conflict
  busy: boolean
  onReload: () => void
  onSaveAnyway: () => void
}

const FIELD_LABEL: Record<string, string> = { description: 'Job', soul: 'Persona', model: 'Model' }

export function ConflictBanner({ conflict, busy, onReload, onSaveAnyway }: ConflictBannerProps) {
  return (
    <div role="status" className="flex flex-col gap-2 rounded-lg border border-border bg-secondary p-3 text-sm">
      <p>{`Changed in another app: ${conflict.fields.map(f => FIELD_LABEL[f] ?? f).join(', ')}. Reload to see their version, or Save anyway.`}</p>
      <div className="flex gap-2">
        <Button type="button" size="sm" variant="outline" onClick={onReload}>Reload</Button>
        <Button type="button" size="sm" disabled={busy} onClick={onSaveAnyway}>Save anyway</Button>
      </div>
    </div>
  )
}

interface ConfirmModelDialogProps {
  confirm: Confirm | null
  busy: boolean
  onConfirm: () => void
  onCancel: () => void
}

/** Hermes asks before a costly model is pinned; its own message is shown. */
export function ConfirmModelDialog({ confirm, busy, onConfirm, onCancel }: ConfirmModelDialogProps) {
  return (
    <Dialog open={confirm !== null} onOpenChange={open => { if (!open) onCancel() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use this model?</DialogTitle>
          <DialogDescription>{confirm?.message}</DialogDescription>
        </DialogHeader>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="button" disabled={busy} onClick={onConfirm}>Use this model</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
