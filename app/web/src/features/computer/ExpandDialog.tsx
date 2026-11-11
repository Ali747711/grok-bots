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
 * and the viewer lives in the side panel's ComputerProvider, so opening and closing this reconnects without handing back.
 * The shell's 12 px padding keeps the screen's 12 px corners concentric with its own 24 px ones.
 */
export function ExpandDialog({ open, title, live, inControl, onClose }: ExpandDialogProps) {
  return (
    <Dialog open={open} onOpenChange={next => !next && onClose()}>
      <DialogContent showCloseButton={false} className="w-[min(96vw,1400px,calc(88vh*16/9))] max-w-none gap-0 p-3 sm:max-w-none">
        <DialogTitle className="sr-only">{title}'s screen</DialogTitle>
        <DialogDescription className="sr-only">The enlarged view of {title}'s screen.</DialogDescription>
        <LiveView live={live} inControl={inControl} expanded onCollapse={onClose} />
      </DialogContent>
    </Dialog>
  )
}
