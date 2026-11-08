import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

import { LiveView } from './LiveView'
import type { LiveHandle } from './use-live-view'

interface ExpandDialogProps {
  readonly open: boolean
  readonly title: string
  readonly live: LiveHandle
  readonly inControl: boolean
  readonly onClose: () => void
}

/**
 * The enlarged view. Its LiveView is the only one attached while it is open (the panel renders none),
 * and the viewer lives in ComputerPanel, so opening and closing this reconnects without handing back.
 */
export function ExpandDialog({ open, title, live, inControl, onClose }: ExpandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent className="max-w-[min(96vw,1400px)] sm:max-w-[min(96vw,1400px)]">
        <DialogTitle className="sr-only">{title}'s screen</DialogTitle>
        <DialogDescription className="sr-only">The enlarged view of {title}'s screen.</DialogDescription>
        <LiveView live={live} inControl={inControl} expanded onCollapse={onClose} />
      </DialogContent>
    </Dialog>
  )
}
