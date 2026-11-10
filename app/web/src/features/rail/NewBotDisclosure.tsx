import { type Ref, useRef, useState } from 'react'

import { Dialog } from '@base-ui/react/dialog'
import { X } from 'lucide-react'
import { motion } from 'motion/react'

import { buttonVariants } from '@/components/ui/button'
import { EMPTY_NEW_BOT_DRAFT, NewBotForm, type NewBotDraft } from '@/features/bots/NewBotForm'
import { morph, press } from '@/lib/motion'
import { cn } from '@/lib/utils'

interface NewBotDisclosureProps {
  /** The bot exists (complete, or the user chose to open a half-made one). */
  onCreated: (name: string) => void
  /** Set both to open the panel from elsewhere (the empty rail's button); left out, the pill owns it. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const LAYOUT_ID = 'new-bot'
/** Esc and the Close button throw the draft away; any other way out (a press outside) keeps it, in case it was a slip. */
const RESETS: readonly Dialog.Root.ChangeEventReason[] = ['escape-key', 'close-press']
// Beside the 272 px rail (8 px page padding, 8 px gap); pulled left and narrowed where the window has no room.
const PANEL =
  'fixed top-2 left-[max(8px,min(288px,calc(100vw-448px)))] z-50 flex max-h-[calc(100dvh-16px)] w-[440px] max-w-[calc(100vw-16px)] flex-col overflow-y-auto rounded-3xl bg-shell p-1 text-sm shadow-xl ring-1 ring-foreground/10 outline-none'
const CLOSE =
  'flex size-7 items-center justify-center rounded-full bg-control text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring'

/** Open state, the draft that outlives a closed panel, and what each way of closing does to it. */
function useNewBotPanel({ onCreated, open: openProp, onOpenChange }: NewBotDisclosureProps) {
  const [ownOpen, setOwnOpen] = useState(false)
  const open = openProp ?? ownOpen
  const setOpen = onOpenChange ?? setOwnOpen
  const [draft, setDraft] = useState<NewBotDraft>(EMPTY_NEW_BOT_DRAFT)
  // A half-made bot came from this draft, so it is used up however the panel closes.
  const spent = useRef(false)
  const returnFocus = useRef(false)

  const close = (reset: boolean) => {
    if (reset || spent.current) setDraft(EMPTY_NEW_BOT_DRAFT)
    spent.current = false
    returnFocus.current = true
    setOpen(false)
  }
  return {
    open,
    draft,
    setDraft,
    show: () => setOpen(true),
    onChange: (next: boolean, details: Dialog.Root.ChangeEventDetails) => {
      if (next) setOpen(true)
      else close(RESETS.includes(details.reason))
    },
    onPartial: () => {
      spent.current = true
    },
    created: (name: string) => {
      close(true)
      onCreated(name)
    },
    // The pill is not mounted while the panel is open, so it takes focus back as it returns.
    pillRef: (node: HTMLButtonElement | null) => {
      if (!node || !returnFocus.current) return
      returnFocus.current = false
      node.focus()
    }
  }
}

function Pill({ ref, onOpen }: { ref: Ref<HTMLButtonElement>; onOpen: () => void }) {
  return (
    <motion.button
      ref={ref}
      type="button"
      layoutId={LAYOUT_ID}
      transition={morph}
      whileTap={press}
      style={{ borderRadius: 16 }}
      aria-haspopup="dialog"
      onClick={onOpen}
      className={cn(buttonVariants({ size: 'sm' }), 'rounded-full font-semibold')}
    >
      + New bot
    </motion.button>
  )
}

/**
 * The "+ New bot" pill, which morphs into the New bot panel beside the rail (crew-bots'
 * create-bot-disclosure). The panel is a modal dialog, so focus stays inside it.
 */
export function NewBotDisclosure(props: NewBotDisclosureProps) {
  const panel = useNewBotPanel(props)
  const popupRef = useRef<HTMLDivElement>(null)

  return (
    <Dialog.Root open={panel.open} onOpenChange={panel.onChange}>
      <div className="flex h-8 flex-none items-center">{!panel.open && <Pill ref={panel.pillRef} onOpen={panel.show} />}</div>
      <Dialog.Portal>
        <Dialog.Popup
          ref={popupRef}
          initialFocus={() => popupRef.current?.querySelector<HTMLElement>('#bot-name') ?? true}
          finalFocus={false}
          render={<motion.div layoutId={LAYOUT_ID} transition={morph} style={{ borderRadius: 24 }} />}
          className={PANEL}
        >
          <div className="flex items-center justify-between py-2 pr-2 pl-4">
            <Dialog.Title className="text-[15px] leading-5 font-semibold">New bot</Dialog.Title>
            <Dialog.Close aria-label="Close" className={CLOSE}>
              <X className="size-4" strokeWidth={2.5} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="p-3 pt-1">
            <NewBotForm draft={panel.draft} onDraft={panel.setDraft} onCreated={panel.created} onPartial={panel.onPartial} />
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
